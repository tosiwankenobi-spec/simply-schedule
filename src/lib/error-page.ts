export function renderErrorPage(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Chronos-V needs a moment</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="theme-color" content="#002E28" />
    <style>
      * { box-sizing: border-box; }
      body { font: 15px/1.6 Inter, ui-sans-serif, system-ui, -apple-system, sans-serif; background: #f8f7f4; color: #002e28; display: grid; place-items: center; min-height: 100vh; margin: 0; padding: 1rem; background-image: radial-gradient(circle at 85% 5%, rgba(83, 177, 126, .18), transparent 26rem), radial-gradient(circle at 10% 90%, rgba(209, 169, 75, .1), transparent 24rem); }
      .card { max-width: 38rem; width: 100%; overflow: hidden; border: 1px solid #d9e2dd; border-radius: 2rem; background: rgba(255,255,255,.92); box-shadow: 0 30px 90px rgba(0,46,40,.12); }
      .brand { display: flex; align-items: center; gap: .75rem; padding: 1.25rem 1.5rem; background: #002e28; color: #f8f7f4; }
      .mark { display: grid; place-items: center; width: 2.5rem; height: 2.5rem; border-radius: .8rem; background: rgba(248,247,244,.1); font-size: 1.1rem; }
      .brand small { display: block; color: rgba(248,247,244,.58); font-size: .625rem; font-weight: 700; letter-spacing: .2em; text-transform: uppercase; }
      .brand strong { display: block; font-family: Georgia, serif; font-size: 1.15rem; font-weight: 500; line-height: 1.2; }
      .content { padding: 2.5rem 2rem; }
      .eyebrow { color: #338e79; font-size: .7rem; font-weight: 700; letter-spacing: .16em; text-transform: uppercase; }
      h1 { max-width: 26rem; font-family: Georgia, serif; font-size: clamp(2rem, 7vw, 3rem); font-weight: 500; letter-spacing: -.02em; line-height: 1.08; margin: .75rem 0 0; }
      p { max-width: 27rem; color: #5e716c; margin: 1rem 0 0; }
      .safe { display: flex; align-items: center; gap: .5rem; margin-top: 1rem; color: #5e716c; font-size: .75rem; }
      .actions { display: flex; gap: .75rem; margin-top: 2rem; flex-wrap: wrap; }
      a, button { min-height: 2.75rem; padding: .65rem 1.15rem; border-radius: .75rem; font: inherit; font-size: .875rem; font-weight: 650; cursor: pointer; text-decoration: none; border: 1px solid transparent; }
      .primary { background: #002e28; color: #f8f7f4; box-shadow: 0 8px 20px rgba(0,46,40,.14); }
      .secondary { background: #fff; color: #002e28; border-color: #d9e2dd; }
      a:focus-visible, button:focus-visible { outline: 2px solid #338e79; outline-offset: 2px; }
      @media (max-width: 30rem) { .content { padding: 2rem 1.5rem; } .actions { flex-direction: column; } a, button { width: 100%; text-align: center; } }
    </style>
  </head>
  <body>
    <div class="card">
      <div class="brand"><span class="mark" aria-hidden="true">V</span><span><small>Verolane</small><strong>Chronos-V</strong></span></div>
      <div class="content">
        <div class="eyebrow">A temporary interruption</div>
        <h1>Your schedule needs a moment.</h1>
        <p>We couldn't finish loading this page. Try once more—your saved plans have not been changed.</p>
        <div class="safe"><span aria-hidden="true">&#10003;</span> Your schedule remains private and protected</div>
        <div class="actions">
          <button class="primary" onclick="location.reload()">Try again</button>
          <a class="secondary" href="/">Return home</a>
        </div>
      </div>
    </div>
  </body>
</html>`;
}
