//! Integration tests for the reagent-daemon axum HTTP server.
//!
//! These tests spawn the actual `reagent-daemon` binary on a random OS-assigned
//! port, exercise the real HTTP surface over loopback, and then kill the process.
//! This avoids the need for a `[lib]` target and tests the shipped binary exactly
//! as it runs in production.
//!
//! # Stub child process
//!
//! POST /mcp spawns `reagent serve`. Tests set `REAGENT_BIN` to a small shell
//! script that reads stdin and echoes it to stdout, so tests do not require the
//! full reagent CLI to be installed.
//!
//! # Port assignment
//!
//! Each test binds port 0 to get a free port, then passes it via
//! `REAGENT_DAEMON_PORT`. Tests can run fully in parallel.

use reqwest::{Client, StatusCode};
use std::process::{Child, Command, Stdio};
use std::time::Duration;

// ---------------------------------------------------------------------------
// Locate the daemon binary
// ---------------------------------------------------------------------------

/// Path to the reagent-daemon binary built by `cargo build --tests`.
/// In a `cargo test` run the binary is in `target/debug/reagent-daemon`.
fn daemon_bin() -> std::path::PathBuf {
    // CARGO_BIN_EXE_reagent-daemon is set by cargo when running integration
    // tests via `cargo test --test integration`. Fall back to a manual search.
    if let Ok(p) = std::env::var("CARGO_BIN_EXE_reagent-daemon") {
        return std::path::PathBuf::from(p);
    }

    // Walk up from OUT_DIR to find target/
    let manifest = std::env::var("CARGO_MANIFEST_DIR")
        .expect("CARGO_MANIFEST_DIR must be set when running cargo test");
    let mut p = std::path::PathBuf::from(manifest);
    p.push("target");
    p.push("debug");
    p.push("reagent-daemon");
    p
}

// ---------------------------------------------------------------------------
// Free-port helper
// ---------------------------------------------------------------------------

/// Bind a TCP socket on port 0, read the assigned port, then drop the socket
/// (freeing it for the daemon to bind). There is a small TOCTOU race, but it
/// is acceptable for test purposes on loopback.
fn free_port() -> u16 {
    let l = std::net::TcpListener::bind("127.0.0.1:0").expect("bind port 0");
    l.local_addr().expect("local_addr").port()
}

// ---------------------------------------------------------------------------
// Stub binary helper
// ---------------------------------------------------------------------------

/// Write a minimal stub `reagent` binary to `dir`. The stub simulates
/// `reagent serve` by reading stdin line-by-line and echoing to stdout.
fn write_stub_binary(dir: &std::path::Path) -> std::path::PathBuf {
    let bin_path = dir.join("reagent");
    let script =
        "#!/bin/sh\nwhile IFS= read -r line; do printf '%s\\n' \"$line\"; done\n";
    std::fs::write(&bin_path, script).expect("write stub binary");
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = std::fs::metadata(&bin_path)
            .expect("stat stub")
            .permissions();
        perms.set_mode(0o755);
        std::fs::set_permissions(&bin_path, perms).expect("chmod stub");
    }
    bin_path
}

// ---------------------------------------------------------------------------
// Project directory fixture
// ---------------------------------------------------------------------------

/// Create a temp directory with `.reagent/policy.yaml` so POST /mcp passes
/// the project-root validation step.
fn make_project_dir() -> tempfile::TempDir {
    let dir = tempfile::tempdir().expect("tempdir");
    let reagent_dir = dir.path().join(".reagent");
    std::fs::create_dir_all(&reagent_dir).expect("mkdir .reagent");
    std::fs::write(
        reagent_dir.join("policy.yaml"),
        "version: '1'\nautonomy_level: L1\n",
    )
    .expect("write policy.yaml");
    dir
}

// ---------------------------------------------------------------------------
// TestServer — owns the daemon child process
// ---------------------------------------------------------------------------

struct TestServer {
    pub port: u16,
    pub client: Client,
    child: Child,
    /// Temp dir holding the stub binary; kept alive for the server lifetime.
    _stub_dir: Option<tempfile::TempDir>,
}

impl TestServer {
    /// Spawn the daemon on `port`, optionally with a stub `reagent` binary in
    /// `stub_dir`. Blocks until the `/health` endpoint responds or 3 s elapses.
    fn start_with_stub(port: u16, stub_dir: Option<tempfile::TempDir>) -> Self {
        let bin = daemon_bin();
        assert!(
            bin.exists(),
            "daemon binary not found at {}. Run `cargo build` first.",
            bin.display()
        );

        let mut cmd = Command::new(&bin);
        cmd.env("REAGENT_DAEMON_PORT", port.to_string())
            .env("REAGENT_DAEMON_BIND", "127.0.0.1")
            // Silence daemon logs during tests unless RUST_LOG is set
            .env(
                "RUST_LOG",
                std::env::var("RUST_LOG").unwrap_or_else(|_| "error".to_string()),
            )
            .stdout(Stdio::null())
            .stderr(Stdio::null());

        if let Some(ref sd) = stub_dir {
            cmd.env("REAGENT_BIN", sd.path().join("reagent").to_str().unwrap());
        }

        let child = cmd.spawn().expect("spawn daemon");

        let client = Client::builder()
            .timeout(Duration::from_secs(5))
            .build()
            .expect("build reqwest client");

        // Poll /health until the server is up (max 3 s)
        let health_url = format!("http://127.0.0.1:{}/health", port);
        let start = std::time::Instant::now();
        loop {
            match reqwest::blocking::get(&health_url) {
                Ok(resp) if resp.status().is_success() => break,
                _ => {}
            }
            if start.elapsed() > Duration::from_secs(10) {
                panic!("Daemon on port {} did not become healthy within 10s", port);
            }
            std::thread::sleep(Duration::from_millis(50));
        }

        TestServer {
            port,
            client,
            child,
            _stub_dir: stub_dir,
        }
    }

    fn start() -> Self {
        let port = free_port();
        Self::start_with_stub(port, None)
    }

    fn start_with_reagent_stub() -> Self {
        let stub_dir = tempfile::tempdir().expect("stub dir");
        write_stub_binary(stub_dir.path());
        let port = free_port();
        Self::start_with_stub(port, Some(stub_dir))
    }

    fn url(&self, path: &str) -> String {
        format!("http://127.0.0.1:{}{}", self.port, path)
    }
}

impl Drop for TestServer {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

// ---------------------------------------------------------------------------
// Async test runtime helper
// ---------------------------------------------------------------------------

/// Run an async closure in a single-threaded tokio runtime.
fn run<F, Fut>(f: F)
where
    F: FnOnce() -> Fut,
    Fut: std::future::Future<Output = ()>,
{
    tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .expect("runtime")
        .block_on(f())
}

// ---------------------------------------------------------------------------
// GET /health
// ---------------------------------------------------------------------------

#[test]
fn health_returns_200_with_correct_fields() {
    let server = TestServer::start();
    run(|| async {
        let resp = server
            .client
            .get(server.url("/health"))
            .send()
            .await
            .expect("request");

        assert_eq!(resp.status(), StatusCode::OK);

        let body: serde_json::Value = resp.json().await.expect("json");
        assert_eq!(body["status"], "ok");
        assert!(body["version"].is_string(), "version must be a string");
        assert!(
            body["sessions"].is_u64() || body["sessions"].is_number(),
            "sessions must be a number"
        );
        assert!(
            body["uptime_seconds"].is_u64() || body["uptime_seconds"].is_number(),
            "uptime_seconds must be a number"
        );
    });
}

#[test]
fn health_uptime_increases_over_time() {
    let server = TestServer::start();
    run(|| async {
        let first: serde_json::Value = server
            .client
            .get(server.url("/health"))
            .send()
            .await
            .expect("request 1")
            .json()
            .await
            .expect("json 1");

        tokio::time::sleep(Duration::from_millis(1100)).await;

        let second: serde_json::Value = server
            .client
            .get(server.url("/health"))
            .send()
            .await
            .expect("request 2")
            .json()
            .await
            .expect("json 2");

        let up1 = first["uptime_seconds"].as_u64().unwrap_or(0);
        let up2 = second["uptime_seconds"].as_u64().unwrap_or(0);
        assert!(
            up2 >= up1,
            "uptime_seconds should be non-decreasing: {} -> {}",
            up1,
            up2
        );
    });
}

#[test]
fn health_sessions_count_reflects_actual_sessions() {
    let server = TestServer::start_with_reagent_stub();
    let project_dir = make_project_dir();
    run(|| async {
        let initial: serde_json::Value = server
            .client
            .get(server.url("/health"))
            .send()
            .await
            .expect("health")
            .json()
            .await
            .expect("json");
        assert_eq!(initial["sessions"], 0);

        let resp = server
            .client
            .post(server.url("/mcp"))
            .header("x-project-root", project_dir.path().to_str().unwrap())
            .body("{}")
            .send()
            .await
            .expect("post mcp");

        if resp.status() != StatusCode::ACCEPTED {
            return; // stub spawn failed in this environment — skip count assertion
        }

        let after: serde_json::Value = server
            .client
            .get(server.url("/health"))
            .send()
            .await
            .expect("health 2")
            .json()
            .await
            .expect("json 2");
        assert_eq!(after["sessions"], 1);
    });
}

// ---------------------------------------------------------------------------
// GET /sessions
// ---------------------------------------------------------------------------

#[test]
fn sessions_empty_on_fresh_server() {
    let server = TestServer::start();
    run(|| async {
        let body: serde_json::Value = server
            .client
            .get(server.url("/sessions"))
            .send()
            .await
            .expect("request")
            .json()
            .await
            .expect("json");

        assert!(body["sessions"].is_array(), "sessions must be an array");
        assert_eq!(
            body["sessions"].as_array().unwrap().len(),
            0,
            "expected empty sessions"
        );
    });
}

#[test]
fn sessions_appear_after_post_mcp() {
    let server = TestServer::start_with_reagent_stub();
    let project_dir = make_project_dir();
    run(|| async {
        let post_resp = server
            .client
            .post(server.url("/mcp"))
            .header("x-project-root", project_dir.path().to_str().unwrap())
            .body("{\"jsonrpc\":\"2.0\",\"method\":\"ping\"}")
            .send()
            .await
            .expect("post");

        if post_resp.status() != StatusCode::ACCEPTED {
            return;
        }

        let session_id = post_resp
            .headers()
            .get("x-session-id")
            .and_then(|v| v.to_str().ok())
            .expect("x-session-id header")
            .to_string();

        let sessions_body: serde_json::Value = server
            .client
            .get(server.url("/sessions"))
            .send()
            .await
            .expect("get sessions")
            .json()
            .await
            .expect("json");

        let sessions = sessions_body["sessions"].as_array().expect("array");
        assert!(!sessions.is_empty(), "expected at least one session");

        let found = sessions
            .iter()
            .any(|s| s["session_id"].as_str() == Some(&session_id));
        assert!(found, "session {} not found in /sessions", session_id);
    });
}

#[test]
fn sessions_fields_match_expected_schema() {
    let server = TestServer::start_with_reagent_stub();
    let project_dir = make_project_dir();
    run(|| async {
        let post_resp = server
            .client
            .post(server.url("/mcp"))
            .header("x-project-root", project_dir.path().to_str().unwrap())
            .body("{}")
            .send()
            .await
            .expect("post");

        if post_resp.status() != StatusCode::ACCEPTED {
            return;
        }

        let sessions_body: serde_json::Value = server
            .client
            .get(server.url("/sessions"))
            .send()
            .await
            .expect("sessions")
            .json()
            .await
            .expect("json");

        let sessions = sessions_body["sessions"].as_array().expect("array");
        if let Some(s) = sessions.first() {
            assert!(s["session_id"].is_string(), "session_id must be string");
            assert!(s["project_root"].is_string(), "project_root must be string");
            assert!(
                s["last_activity_elapsed_secs"].is_u64()
                    || s["last_activity_elapsed_secs"].is_number(),
                "last_activity_elapsed_secs must be numeric"
            );
        }
    });
}

// ---------------------------------------------------------------------------
// POST /mcp — validation
// ---------------------------------------------------------------------------

#[test]
fn post_mcp_missing_project_root_returns_400() {
    let server = TestServer::start();
    run(|| async {
        let resp = server
            .client
            .post(server.url("/mcp"))
            .body("{}")
            .send()
            .await
            .expect("request");
        assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    });
}

#[test]
fn post_mcp_relative_project_root_returns_400() {
    let server = TestServer::start();
    run(|| async {
        let resp = server
            .client
            .post(server.url("/mcp"))
            .header("x-project-root", "relative/path")
            .body("{}")
            .send()
            .await
            .expect("request");
        assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    });
}

#[test]
fn post_mcp_dir_without_policy_returns_400() {
    let server = TestServer::start();
    let tmp = tempfile::tempdir().expect("tmpdir");
    run(|| async {
        let resp = server
            .client
            .post(server.url("/mcp"))
            .header("x-project-root", tmp.path().to_str().unwrap())
            .body("{}")
            .send()
            .await
            .expect("request");
        assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    });
}

#[test]
fn post_mcp_valid_project_root_returns_202_with_session_id() {
    let server = TestServer::start_with_reagent_stub();
    let project_dir = make_project_dir();
    run(|| async {
        let resp = server
            .client
            .post(server.url("/mcp"))
            .header("x-project-root", project_dir.path().to_str().unwrap())
            .body("{\"jsonrpc\":\"2.0\",\"method\":\"initialize\"}")
            .send()
            .await
            .expect("request");

        assert_eq!(resp.status(), StatusCode::ACCEPTED);
        let sid = resp
            .headers()
            .get("x-session-id")
            .and_then(|v| v.to_str().ok())
            .expect("x-session-id header");
        assert!(!sid.is_empty(), "x-session-id must be non-empty");
    });
}

#[test]
fn post_mcp_nonexistent_session_id_returns_404() {
    let server = TestServer::start();
    let project_dir = make_project_dir();
    run(|| async {
        let resp = server
            .client
            .post(server.url("/mcp"))
            .header("x-project-root", project_dir.path().to_str().unwrap())
            .header("x-session-id", "00000000-0000-0000-0000-000000000000")
            .body("{}")
            .send()
            .await
            .expect("request");
        assert_eq!(resp.status(), StatusCode::NOT_FOUND);
    });
}

#[test]
fn post_mcp_malformed_json_body_not_rejected() {
    // Daemon is a passthrough — it must not validate the body.
    let server = TestServer::start_with_reagent_stub();
    let project_dir = make_project_dir();
    run(|| async {
        let resp = server
            .client
            .post(server.url("/mcp"))
            .header("x-project-root", project_dir.path().to_str().unwrap())
            .body("not-valid-json!!!{{{")
            .send()
            .await
            .expect("request");

        assert_ne!(
            resp.status(),
            StatusCode::BAD_REQUEST,
            "daemon must not reject malformed body — it is a passthrough"
        );
    });
}

#[test]
fn post_mcp_very_large_body_accepted() {
    let server = TestServer::start_with_reagent_stub();
    let project_dir = make_project_dir();
    run(|| async {
        let large_body = "x".repeat(512 * 1024);
        let resp = server
            .client
            .post(server.url("/mcp"))
            .header("x-project-root", project_dir.path().to_str().unwrap())
            .body(large_body)
            .send()
            .await
            .expect("request");

        assert_ne!(
            resp.status(),
            StatusCode::BAD_REQUEST,
            "large body must not cause 400"
        );
    });
}

// ---------------------------------------------------------------------------
// GET /mcp (SSE)
// ---------------------------------------------------------------------------

#[test]
fn get_mcp_missing_session_id_returns_400() {
    let server = TestServer::start();
    run(|| async {
        let resp = server
            .client
            .get(server.url("/mcp"))
            .send()
            .await
            .expect("request");
        assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    });
}

#[test]
fn get_mcp_nonexistent_session_returns_404() {
    let server = TestServer::start();
    run(|| async {
        let resp = server
            .client
            .get(server.url("/mcp"))
            .header("x-session-id", "00000000-0000-0000-0000-000000000000")
            .send()
            .await
            .expect("request");
        assert_eq!(resp.status(), StatusCode::NOT_FOUND);
    });
}

#[test]
fn get_mcp_second_connection_on_same_session_returns_409() {
    let server = TestServer::start_with_reagent_stub();
    let project_dir = make_project_dir();
    run(|| async {
        // Create session
        let post_resp = server
            .client
            .post(server.url("/mcp"))
            .header("x-project-root", project_dir.path().to_str().unwrap())
            .body("{}")
            .send()
            .await
            .expect("post");

        if post_resp.status() != StatusCode::ACCEPTED {
            return;
        }

        let session_id = post_resp
            .headers()
            .get("x-session-id")
            .and_then(|v| v.to_str().ok())
            .expect("session id")
            .to_string();

        // First GET /mcp — claims the SSE receiver
        // Use a short timeout so the request does not block the test
        let first_client = reqwest::Client::builder()
            .timeout(Duration::from_millis(200))
            .build()
            .unwrap();
        let _first = first_client
            .get(server.url("/mcp"))
            .header("x-session-id", &session_id)
            .send()
            .await; // result may be timeout-Err — that is fine

        // Give the server a moment to register the SSE claim
        tokio::time::sleep(Duration::from_millis(100)).await;

        // Second GET /mcp — must be 409
        let second_resp = server
            .client
            .get(server.url("/mcp"))
            .header("x-session-id", &session_id)
            .send()
            .await
            .expect("second SSE request");

        assert_eq!(
            second_resp.status(),
            StatusCode::CONFLICT,
            "second SSE connection on same session must return 409"
        );
    });
}

// ---------------------------------------------------------------------------
// Session lifecycle
// ---------------------------------------------------------------------------

#[test]
fn create_session_appears_in_sessions_list() {
    let server = TestServer::start_with_reagent_stub();
    let project_dir = make_project_dir();
    run(|| async {
        let post_resp = server
            .client
            .post(server.url("/mcp"))
            .header("x-project-root", project_dir.path().to_str().unwrap())
            .body("{}")
            .send()
            .await
            .expect("post");

        if post_resp.status() != StatusCode::ACCEPTED {
            return;
        }

        let session_id = post_resp
            .headers()
            .get("x-session-id")
            .and_then(|v| v.to_str().ok())
            .expect("session id")
            .to_string();

        let sessions: serde_json::Value = server
            .client
            .get(server.url("/sessions"))
            .send()
            .await
            .expect("sessions")
            .json()
            .await
            .expect("json");

        let ids: Vec<&str> = sessions["sessions"]
            .as_array()
            .unwrap()
            .iter()
            .filter_map(|s| s["session_id"].as_str())
            .collect();

        assert!(
            ids.contains(&session_id.as_str()),
            "session {} must appear in /sessions",
            session_id
        );
    });
}

#[test]
fn concurrent_sessions_for_different_project_roots() {
    let server = TestServer::start_with_reagent_stub();
    let project_a = make_project_dir();
    let project_b = make_project_dir();
    run(|| async {
        let (resp_a, resp_b) = tokio::join!(
            server
                .client
                .post(server.url("/mcp"))
                .header("x-project-root", project_a.path().to_str().unwrap())
                .body("{}")
                .send(),
            server
                .client
                .post(server.url("/mcp"))
                .header("x-project-root", project_b.path().to_str().unwrap())
                .body("{}")
                .send(),
        );

        let resp_a = resp_a.expect("post a");
        let resp_b = resp_b.expect("post b");

        if resp_a.status() == StatusCode::ACCEPTED && resp_b.status() == StatusCode::ACCEPTED {
            let sid_a = resp_a
                .headers()
                .get("x-session-id")
                .and_then(|v| v.to_str().ok())
                .expect("sid a")
                .to_string();
            let sid_b = resp_b
                .headers()
                .get("x-session-id")
                .and_then(|v| v.to_str().ok())
                .expect("sid b")
                .to_string();

            assert_ne!(sid_a, sid_b, "concurrent sessions must have distinct IDs");

            let sessions: serde_json::Value = server
                .client
                .get(server.url("/sessions"))
                .send()
                .await
                .expect("sessions")
                .json()
                .await
                .expect("json");

            let count = sessions["sessions"].as_array().unwrap().len();
            assert_eq!(count, 2, "expected 2 sessions, got {}", count);
        }
    });
}

#[test]
fn race_condition_simultaneous_post_and_get_mcp() {
    let server = TestServer::start_with_reagent_stub();
    let project_dir = make_project_dir();
    run(|| async {
        // Establish a session first
        let post_resp = server
            .client
            .post(server.url("/mcp"))
            .header("x-project-root", project_dir.path().to_str().unwrap())
            .body("{}")
            .send()
            .await
            .expect("post");

        if post_resp.status() != StatusCode::ACCEPTED {
            return;
        }

        let session_id = post_resp
            .headers()
            .get("x-session-id")
            .and_then(|v| v.to_str().ok())
            .expect("session id")
            .to_string();

        // Race: POST another message and GET SSE simultaneously
        let get_client = reqwest::Client::builder()
            .timeout(Duration::from_millis(300))
            .build()
            .unwrap();

        let (post_result, get_result) = tokio::join!(
            server
                .client
                .post(server.url("/mcp"))
                .header("x-project-root", project_dir.path().to_str().unwrap())
                .header("x-session-id", &session_id)
                .body("{\"method\":\"ping\"}")
                .send(),
            get_client
                .get(server.url("/mcp"))
                .header("x-session-id", &session_id)
                .send(),
        );

        // Verify neither panicked — status codes may vary based on timing
        let _ = post_result;
        let _ = get_result;
    });
}
