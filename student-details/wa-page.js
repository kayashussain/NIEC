// The page a tap on the "WhatsApp" notification opens on the phone (/wa?n=977...&name=...): it opens the WhatsApp app straight on
// the student's chat (whatsapp://, no "Continue to chat" page), with one big button in case the phone asks for a tap first.
(function () {
  const q = new URLSearchParams(location.search);
  const n = String(q.get('n') || '').replace(/\D/g, '').slice(0, 15);
  const name = String(q.get('name') || '').slice(0, 80);
  const text = String(q.get('text') || '').slice(0, 1500);
  const $ = (id) => document.getElementById(id);
  if (n.length < 8) { $('who').textContent = 'This chat link is not complete.'; $('go').hidden = true; $('web').hidden = true; if ($('face')) $('face').hidden = true; return; }
  const app = `whatsapp://send?phone=${n}${text ? `&text=${encodeURIComponent(text)}` : ''}`;
  const web = `https://wa.me/${n}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
  document.title = `WhatsApp ${name || '+' + n} · ISR`;
  $('who').textContent = name || 'The student';
  // The student's initials in a soft circle, as on the student card.
  const ini = (name || '').split(/\s+/).filter(Boolean).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
  if ($('face')) $('face').textContent = ini || '+';
  $('num').textContent = '+' + n;
  $('go').href = app;
  $('web').href = web;
  // Straight into the app; a phone that wants a tap first keeps this page with the button.
  setTimeout(() => { location.href = app; }, 50);
})();
