# Desktop and runtime security

- **Renderer isolation**: `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, CSP in
  `index.html`, `setWindowOpenHandler` denies popups and opens http(s) externally, `will-navigate` blocked.
- **IPC surface**: one `invoke(command, params)` plus a handful of narrowly typed calls
  (`pickDirectory`, `openExternal` restricted to http(s), preferences). The main process re-validates
  the command name and params with the contracts' zod schemas before forwarding to the runtime.
- **Runtime access**: loopback only (`127.0.0.1`), random 32-byte token per launch, 5 s authentication
  timeout, constant-time token comparison, 4 MB frame cap. The discovery file `~/.codeo/runtime.json`
  is written with mode 0600.
- **Authorization**: every command declares a scope; the server grants scopes by client kind (mobile
  clients never get `workspace:admin`). The gateway narrows further per device.
- **Approvals**: created server-side from the provider's permission callback, persisted immediately,
  a single decision is accepted (state machine), expired or cancelled requests deny the tool, a decision
  never carries over to another tool call. Restarting the runtime expires pending requests.
- **Processes**: agents run through the official SDKs' own binaries; git runs with `execFile` and
  argument arrays, `GIT_TERMINAL_PROMPT=0`; worktree removal refuses dirty trees unless forced explicitly.
- **Secrets**: never read or stored by Codeo — the SDKs use the user's existing login. Logs and
  outgoing frames pass through `redactSecrets`.
