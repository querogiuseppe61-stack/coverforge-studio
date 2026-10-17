/* Avvio: preferenze ricordate nei controlli, tipi di progetto, mascherina, server o modalità diretta,
   caricamento di modelli, cronologia, riferimenti e profilo di stile. Si carica per ultimo. */

(function init(){
  // La chiave si ricorda solo se lo chiedi: meglio tenerla in .env, che non passa dal browser.
  let storedKey = '';
  try { storedKey = localStorage.getItem('or_key') || ''; } catch {}
  $('#apiKey').value = storedKey;
  $('#rememberKey').checked = Boolean(storedKey);
  const saveKey = () => {
    try {
      if ($('#rememberKey').checked && key()) localStorage.setItem('or_key', key());
      else localStorage.removeItem('or_key');
    } catch {}
  };
  $('#apiKey').onchange = saveKey;
  $('#rememberKey').onchange = saveKey;
  $('#wantText').onchange = e => $('#textFields').classList.toggle('hidden', !e.target.checked);

  // Guida per il prompt: la vecchia casella "Skill Prompt Master" diventa un selettore.
  // Chi l'aveva spenta resta senza guida; chi l'aveva accesa passa a quella adatta all'app.
  let guide = uiGet('guide');
  if (!guide) {
    let old = null; try { old = localStorage.getItem('pm_skill'); } catch {}
    guide = old === '0' ? 'none' : 'cover';
  }
  $('#promptGuide').value = ['cover', 'pm', 'none'].includes(guide) ? guide : 'cover';
  $('#promptGuide').onchange = e => uiSet('guide', e.target.value);
  $('#approveIdea').checked = uiGet('approve') === true;
  $('#useStyle').checked = uiGet('useStyle') === true;
  $('#styleRefs').checked = uiGet('styleRefs') === true;
  $('#refineLLM').checked = uiGet('refineLLM') !== false;   // attiva di default
  $('#refineLLM').onchange = e => uiSet('refineLLM', e.target.checked);
  $('#sendAspect').checked = uiGet('sendAspect') !== false;   // attivo di default
  $('#sendAspect').onchange = e => uiSet('sendAspect', e.target.checked);
  $('#refineRefs').checked = uiGet('refineRefs') === true;
  $('#refineRefs').onchange = e => uiSet('refineRefs', e.target.checked);
  $('#styleRefs').onchange = e => uiSet('styleRefs', e.target.checked);
  $('#useStyle').onchange = e => { uiSet('useStyle', e.target.checked); if (e.target.checked && !styleState.text) log('⚠ Il profilo di stile è vuoto: aggiornalo o scrivilo prima di usarlo.'); };
  const savedLimit = String(uiGet('refLimit') ?? '');
  if ([...$('#refLimit').options].some(o => o.value === savedLimit)) $('#refLimit').value = savedLimit;
  $('#refLimit').onchange = e => uiSet('refLimit', e.target.value);

  const savedCat = uiGet('cat');
  if (savedCat && CATS[savedCat]) cat = savedCat;

  const catsEl = $('#cats');
  for (const [k,v] of Object.entries(CATS)){
    const d = document.createElement('div');
    d.className = 'cat' + (k===cat?' on':''); d.textContent = v.label; d.dataset.k = k;
    d.setAttribute('aria-pressed', String(k===cat));
    d.onclick = () => {
      cat = k; uiSet('cat', k);
      document.querySelectorAll('.cat').forEach(x=>{ x.classList.toggle('on', x===d); x.setAttribute('aria-pressed', String(x===d)); });
      fillRatios();
    };
    activatable(d);
    catsEl.appendChild(d);
  }
  fillRatios();

  const savedStyle = uiGet('style');
  if (savedStyle && [...$('#style').options].some(o => o.value === savedStyle)) $('#style').value = savedStyle;
  $('#style').onchange = e => uiSet('style', e.target.value);
  $('#ratio').onchange = e => uiSet('ratio:' + cat, e.target.value);
  $('#textModel').onchange = e => uiSet('textModel', e.target.value);
  $('#imageModel').onchange = e => uiSet('imageModel', e.target.value);

  initMask();   // mascherina testo (mask.js)

  (async function(){
    try {
      const h = await fetch('/api/health');
      if (h.ok) {
        MODE = 'proxy';
        if ((await h.json().catch(() => ({}))).hasServerKey) {
          hasServerKey = true;
          $('#apiKey').placeholder = 'Facoltativa: il server ha già una chiave (.env)';
        }
      }
    } catch { MODE = 'direct'; }
    $('#connBadge').textContent = MODE === 'proxy' ? '● proxy locale' : '● browser diretto';
    // le tre liste sono indipendenti: se una fallisce (es. OpenRouter irraggiungibile) le altre si caricano comunque
    const steps = [['modelli', () => loadModels(3)], ['cronologia', loadHistory], ['riferimenti', loadRefFiles], ['profilo di stile', loadStyle]];
    // primo avvio (nessuna scelta salvata): procedura di benvenuto, che si aggiorna quando arrivano i modelli
    if (!uiGet('welcomeDone') && !uiGet('textModel')) openWelcome();
    const results = await Promise.allSettled(steps.map(([, fn]) => fn()));
    results.forEach((r, i) => { if (r.status === 'rejected') log(`⚠ ${steps[i][0]}: ${r.reason.message}`); });
  })();
})();

/* ── Init upload ── */
setupFileUpload();
