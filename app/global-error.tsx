"use client"

// Last-resort boundary (errors in the root layout itself). Must render its own <html>/<body>.
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: "sans-serif", background: "#f2f4f2", color: "#123321" }}>
        <div style={{ minHeight: "100dvh", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div style={{ maxWidth: 360, width: "100%", background: "#fff", borderRadius: 16, padding: 16, boxShadow: "0 10px 30px rgba(0,0,0,.15)" }}>
            <h1 style={{ fontSize: 16, margin: 0 }}>Kuch gadbad ho gayi</h1>
            <pre style={{ fontSize: 10, background: "rgba(0,0,0,.05)", padding: 8, borderRadius: 8, whiteSpace: "pre-wrap", wordBreak: "break-word", maxHeight: 128, overflow: "auto" }}>
              {String(error?.message || error).slice(0, 400)}
            </pre>
            <button onClick={() => reset()} style={{ marginTop: 12, width: "100%", minHeight: 44, border: 0, borderRadius: 12, background: "#10b981", color: "#fff", fontWeight: 700 }}>
              Dobara try karo
            </button>
          </div>
        </div>
      </body>
    </html>
  )
}
