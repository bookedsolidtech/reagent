---
'@bookedsolid/reagent': patch
---

fix(account): obscure more of the token in check/whoami output

Token preview now shows `sk-ant-...xxxx` (last 4 chars only) instead
of exposing the first 12 characters.
