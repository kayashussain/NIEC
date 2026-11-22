// The page a tap on the "WhatsApp" notification opens on the phone (/wa?n=977...&name=...): it opens the WhatsApp app straight on
// the student's chat (whatsapp://, no "Continue to chat" page), with one big button in case the phone asks for a tap first.
// With call=1 (the "Call" notification, the owner, 17 Nov 2026) it rings the student instead (tel:).
(function () {
  // A quiet check-in with Vishnu's service worker, so this phone's push address stays current (sw.js heal). It never delays the chat.
  try { if (navigator.serviceWorker && navigator.serviceWorker.controller) navigator.serviceWorker.controller.postMessage('heal'); } catch (e) { /* fine */ }
  const q = new URLSearchParams(location.search);
  const n = String(q.get('n') || '').replace(/\D/g, '').slice(0, 15);
  const name = String(q.get('name') || '').slice(0, 80);
  const text = String(q.get('text') || '').slice(0, 1500);
  const $ = (id) => document.getElementById(id);
  if (n.length < 8) { $('who').textContent = 'This chat link is not complete.'; $('go').hidden = true; $('web').hidden = true; if ($('face')) $('face').hidden = true; return; }
  if (q.get('call') === '1') {
    const tel = `tel:+${n}`;
    document.title = `Call ${name || '+' + n} · Vishnu`;
    document.querySelector('.wa-kicker').textContent = 'Call';
    $('who').textContent = name || 'The student';
    const ini0 = (name || '').split(/\s+/).filter(Boolean).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
    if ($('face')) $('face').textContent = ini0 || '+';
    $('num').textContent = '+' + n;
    $('go').href = tel; $('go').textContent = 'Call now';
    $('web').hidden = true;
    const help = document.querySelector('.wa-box .p-muted'); if (help) help.textContent = 'If the call did not start by itself, tap the button. The number is not saved on your phone.';
    setTimeout(() => { location.href = tel; }, 50);
    return;
  }
  const app = `whatsapp://send?phone=${n}${text ? `&text=${encodeURIComponent(text)}` : ''}`;
  const web = `https://wa.me/${n}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
  document.title = `WhatsApp ${name || '+' + n} · Vishnu`;
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
