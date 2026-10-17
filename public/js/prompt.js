/* Prompt: guida, istruzioni al modello di testo per tipo di progetto, idee, conferma dell'idea, generazione. */

/* ── Prompt engineer ── */

/* Guida per il prompt: «CoverForge» (prompt-guide/cover-forge.md, a sezioni: generale + tipo di progetto + testo
   sì/no + riferimenti) oppure «Prompt Master» (estratti di prompt-master-main/). Servono entrambe il server locale. */
let pmContent = null;

async function loadGuide() {
  const mode = $('#promptGuide').value;
  if (mode === 'none') return null;
  if (MODE !== 'proxy') { log('⚠ La guida per il prompt richiede il server locale: proseguo senza.'); return null; }
  try {
    if (mode === 'pm') {
      if (!pmContent) {
        const r = await fetch('/api/prompt-master');
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `HTTP ${r.status}`);
        pmContent = (await r.json()).content || null;
      }
      return pmContent;
    }
    const r = await fetch('/api/prompt-guide');   // il server la rilegge solo se il file è cambiato
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `HTTP ${r.status}`);
    const g = (await r.json()).sections;
    return [g.generale, g[cat], $('#wantText').checked ? g.testo : g['senza-testo'],
      getSelectedImageUrls().length ? g.riferimenti : ''].filter(Boolean).join('\n\n');
  } catch (e) { log('⚠ Guida per il prompt non disponibile: ' + e.message); return null; }
}

function buildContextBlock(ctx) {
  if (!ctx || !ctx.trim()) return '';
  return `\n\nContesto di ispirazione (riferimenti allegati dall'utente):\n${ctx}\n`;
}

/* Come leggere i testi allegati, per tipo di progetto: un racconto, un testo di canzone e un brief di marca
   non vanno interpretati allo stesso modo. Sta nel codice (non nella guida) così vale con qualunque guida. */
const REF_TEXT_HINT = {
  libro: "I testi di riferimento sono parti del libro o materiali su di esso. Se è narrativa ricava personaggi, ambientazione, atmosfera e simboli ricorrenti; se è un saggio ricava il tema, la tesi centrale e il tono. Non citarli alla lettera.",
  album: "I testi di riferimento sono canzoni o note sul disco. Ricava i temi, le emozioni, l'atmosfera, le immagini poetiche ricorrenti e il genere o le sonorità suggerite. Non citare versi.",
  logo: "I testi di riferimento descrivono la marca. Ricava cosa fa, a chi si rivolge, i valori, il tono di voce e le parole chiave, e traducili in un simbolo semplice e riconoscibile. Rispetta le indicazioni su colori, forme e stile se presenti.",
  icona: "I testi di riferimento descrivono l'app o il prodotto. Ricava la funzione principale e scegli UN solo concetto da rappresentare con un solo simbolo. Rispetta le indicazioni su colori e stile se presenti.",
  header: "I testi di riferimento sono l'articolo o la pagina a cui serve l'header, oppure descrivono il tono del sito. Ricava l'argomento e il tono e proponi un'immagine che li evochi senza illustrarli alla lettera. Rispetta le indicazioni di stile se presenti.",
  blog: `I testi di riferimento sono l'articolo del blog a cui serve l'immagine principale: è la fonte più importante, più del brief. Leggilo tutto, compresa la chiusa, e ricava:
1) l'ARGOMENTO vero, cioè di cosa parla davvero e qual è la sua idea centrale, non solo la parola chiave del titolo;
2) il TONO, cioè come è scritto (ironico, polemico, intimo, divulgativo, tecnico, malinconico, entusiasta, provocatorio…);
3) lo SPIRITO, cioè l'intenzione e l'emozione che lascia al lettore (indignazione, speranza, curiosità, nostalgia, invito ad agire…).
L'immagine deve rendere insieme tutte e tre le cose: chi la vede, prima di leggere, deve intuire il tema e il registro dell'articolo. Tono e spirito decidono luce, palette, stile e atmosfera: un pezzo ironico non ha un'immagine solenne, uno intimo non ha un'immagine da comunicato aziendale.
Le indicazioni dell'utente nel brief si rispettano (elementi richiesti, stile, colori, vincoli), ma restano dentro il tono e lo spirito dell'articolo, salvo che l'utente chieda espressamente un registro diverso. Non citare frasi dell'articolo e non scrivere il titolo nell'immagine se non è richiesto.`
};

/* Profilo di stile dell'utente: orienta il gusto, ma viene dopo il brief e lo stile scelto nel menu */
const USER_STYLE_HINT = {
  blog: "Per l'immagine di un articolo: tono e spirito dell'articolo decidono l'atmosfera, il profilo decide il trattamento grafico (tecnica, palette di base, composizione).",
  logo: "Per un logo applica del profilo solo palette e gusto generale: la semplicità richiesta resta la regola.",
  icona: "Per un'icona applica del profilo solo palette e gusto generale: la semplicità richiesta resta la regola."
};
function userStyleBlock(profile){
  if (!profile) return '';
  return `\n\n=== STILE PREFERITO DELL'UTENTE ===\n${profile}\n=== FINE STILE ===
È il gusto grafico dell'utente, ricavato dalle immagini che ha scelto. Orienta tecnica, palette, luce, composizione e trattamento verso questo stile.
Priorità: le richieste esplicite del brief e lo stile artistico obbligatorio, se indicato, vengono prima; il profilo decide ciò che il brief non decide. È uno stile, non un tema: non riprendere i soggetti delle immagini da cui è stato ricavato.${USER_STYLE_HINT[cat] ? ' ' + USER_STYLE_HINT[cat] : ''}`;
}

/* images: { n, seen } — quante immagini sono allegate e se il modello di testo le vede */
function sysPrompt(mode, refContext, guide, images, concept = false, userStyle = ''){
  const c = CATS[cat], ratio = $('#ratio').value;
  const styleVal = $('#style').value;
  const styleHint = (styleVal ? `\nStile artistico OBBLIGATORIO: ${STYLES[styleVal]}.` : '') + userStyleBlock(userStyle);
  const ctx = buildContextBlock(refContext);
  const guideBlock = guide ? `\n\n=== GUIDA PER IL PROMPT ===\n${guide}\n=== FINE GUIDA ===\n` : '';
  const imgNote = !images.n ? ''
    : images.seen ? `\n\nAllegate ${images.n} immagini di riferimento: le vedi nel messaggio dell'utente. Ricavane stile, palette e composizione; il generatore le riceverà insieme al prompt.`
    : `\n\nAl generatore verranno allegate ${images.n} immagini di riferimento che tu non vedi: non descriverle né inventarne il contenuto.`;
  const base = `Sei un art director e prompt engineer per modelli di generazione immagini.
Formato obbligatorio: ${ratio} (${c.hint}).${styleHint}${ctx}${imgNote}${guideBlock}`;
  const txt = $('#wantText').checked
    ? `Testo DA inserire ESATTAMENTE: titolo "${$('#titleTxt').value||''}", secondario "${$('#subTxt').value||''}". Riserva spazio leggibile.`
    : `Nessun testo nell'immagine.`;
  const textRefs = refContext ? (REF_TEXT_HINT[cat] || REF_TEXT_HINT.libro) : '';
  // per il blog il modello scrive prima la sua lettura dell'articolo: un campo da compilare lo obbliga a leggerlo davvero
  const blogRead = cat === 'blog' && refContext;
  const articoloField = blogRead ? '"articolo":{"argomento":"...","tono":"...","spirito":"..."},' : '';
  const articoloRule = blogRead ? `\n- "articolo": la tua lettura dell'articolo, in italiano, una frase per campo: argomento e idea centrale, tono, spirito. Il resto della risposta deve discendere da qui.` : '';
  const imgRule = images.n && mode !== 'ideas'
    ? 'Nel prompt includi una frase che chieda al generatore di usare le immagini allegate come riferimento (stile, palette, atmosfera) senza copiarle.' : '';
  if (mode === 'ideas') return `${base}
Proponi 3 concept creativi DIVERSI. ${textRefs}${blogRead ? ' Tutte e tre le proposte devono essere fedeli al tono e allo spirito dell\'articolo: diverse nell\'idea visiva, non nel registro.' : ''}
Rispondi SOLO JSON: {${articoloField}"ideas":[{"title":"...","concept":"descrizione in italiano, 40-70 parole"}]}${articoloRule}`;
  // Con la guida CoverForge il modello passa da un'idea scritta: prima scarta le immagini più ovvie, poi sceglie il concept,
  // poi scrive il prompt. Un'istruzione generica ("evita i cliché") viene facilmente ignorata; un campo da compilare no.
  const schema = concept
    ? `Rispondi SOLO JSON con questi campi, in quest'ordine:
{${articoloField}"ovvie":["...","..."],"concept":"...","prompt":"..."}${articoloRule}
- "ovvie": le 5 immagini più prevedibili per questo tema. Includi sia quelle letterali (il soggetto mostrato com'è) sia le metafore più usate dall'editoria (due mani che si toccano, uomo contro macchina, mezzo volto e mezzo circuito, la lampadina, la scalata, il bivio, la bilancia). Servono solo per scartarle.
- "concept": in una frase l'idea visiva scelta. Non deve essere una variante di nessuna delle ovvie. ${cat === 'blog'
    ? "Preferisci un oggetto, un gesto o un luogo concreto e specifico del mondo dell'articolo a una metafora astratta sul tema, e fai in modo che luce e atmosfera dicano il tono e lo spirito che hai letto."
    : "Per un libro non narrativo preferisci un oggetto, un gesto o un luogo concreto e specifico del mondo del libro a una metafora astratta sul tema, oppure un trattamento grafico insolito; per un romanzo i simboli del genere vanno bene, con un'angolatura meno scontata."}
- "prompt": il prompt finale in inglese (60-140 parole) che realizza il concept.`
    : `Rispondi SOLO JSON: {${articoloField}"prompt":"..."}${articoloRule}`;
  return `${base} ${txt}
Trasforma il brief in UN prompt tecnico in INGLESE (i modelli grafici rendono meglio in inglese). ${textRefs} ${imgRule}
Struttura: soggetto → composizione/spazi negativi → stile/medium → illuminazione → palette → dettagli qualitativi.
${concept ? '' : '60-140 parole. '}${schema}`;
}

/* Contesto completo di una richiesta al modello di testo: prompt di sistema + messaggio dell'utente.
   Se il modello ha la vista e ci sono immagini spuntate, le immagini ridotte viaggiano nel messaggio. */
async function buildTextRequest(mode, userText){
  const refs = await buildRefContext();
  const guide = await loadGuide();
  const nImg = getSelectedImageUrls().length;
  const seen = nImg > 0 && textModelSeesImages();
  const parts = seen ? await buildRefImageParts() : [];
  const images = { n: nImg, seen: parts.length > 0 };
  const useConcept = mode === 'prompt' && $('#promptGuide').value === 'cover' && Boolean(guide);
  const userStyle = $('#useStyle').checked && MODE === 'proxy' ? styleState.text.trim() : '';
  if ($('#useStyle').checked && !userStyle) log('⚠ «Usa il mio stile» è attivo ma il profilo è vuoto: proseguo senza.');
  const system = { role: 'system', content: sysPrompt(mode, refs.context, guide, images, useConcept, userStyle) };
  const user = parts.length ? { role: 'user', content: [{ type: 'text', text: userText }, ...parts] } : { role: 'user', content: userText };
  const notes = [];
  if (cat === 'blog' && !refs.used.length) log('⚠ Blog: nessun articolo spuntato nei Riferimenti. Allega il testo dell\'articolo (txt, md, PDF, DOCX) e spuntalo: il prompt ne segue argomento, tono e spirito. Proseguo solo con il brief.');
  if (refs.used.length) notes.push(`testi: ${refs.used.map(u => `${u.name} (${nf(u.chars)}${u.sampled ? ' su ' + nf(u.total) : ''} car.)`).join(', ')}`);
  if (nImg) notes.push(images.seen ? `${parts.length} immagini viste dal modello di testo` : `${nImg} immagini solo per il generatore (il modello di testo non ha la vista)`);
  if (guide) notes.push(`guida «${$('#promptGuide').selectedOptions[0].textContent}»`);
  if (userStyle) notes.push('il mio stile');
  if (notes.length) log('Uso nel prompt → ' + notes.join(' · '));
  return [system, user];
}

/* Primo oggetto JSON bilanciato nel testo (ignora recinti ``` e frasi intorno) */
function extractJSON(s){
  const text = String(s ?? '').replace(/```(?:json)?/gi, '');
  for (let i = text.indexOf('{'); i >= 0; i = text.indexOf('{', i + 1)) {
    let depth = 0, inStr = false, esc = false;
    for (let j = i; j < text.length; j++) {
      const c = text[j];
      if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
      if (c === '"') inStr = true;
      else if (c === '{') depth++;
      else if (c === '}' && --depth === 0) { try { return JSON.parse(text.slice(i, j + 1)); } catch { break; } }
    }
  }
  throw new Error('il modello non ha risposto in formato JSON');
}

/* Chiede un JSON al modello di testo; se la risposta non è valida lo richiede una volta */
async function askJSON(messages){
  for (let attempt = 0; ; attempt++) {
    const r = await orFetch('/api/craft', { model: $('#textModel').value, messages });
    try { return extractJSON(r.content); }
    catch (e) {
      if (attempt >= 1) throw new Error(e.message + ': riprova o scegli un altro modello.');
      log('Risposta non in formato JSON: la richiedo una volta.');
      messages = [...messages, { role: 'assistant', content: String(r.content ?? '') },
        { role: 'user', content: 'Rispondi SOLO con JSON valido nel formato richiesto, senza altro testo.' }];
    }
  }
}

/* ── Azioni principali ── */
$('#btnIdeas').onclick = async () => {
  busy(true); log('Chiedo 3 proposte al LLM…');
  try {
    const messages = await buildTextRequest('ideas', $('#brief').value.trim() || 'sorprendimi');
    const j = await askJSON(messages);
    const ideas = j.ideas;
    const reading = articleReading(j);
    if (reading) log(`📰 Lettura dell'articolo → ${reading}`);
    if (!Array.isArray(ideas) || !ideas.length) throw new Error('il modello non ha restituito proposte');
    const box = $('#ideasBox'); box.innerHTML=''; box.classList.remove('hidden');
    ideas.forEach(i => {
      const d = document.createElement('div'); d.className='idea';
      const t = document.createElement('b'); t.textContent = String(i.title ?? '');
      d.append(t, document.createElement('br'), document.createTextNode(String(i.concept ?? '')));
      d.onclick = () => { $('#brief').value = String(i.concept ?? ''); box.classList.add('hidden'); craft(); };
      activatable(d);
      box.appendChild(d);
    });
  } catch(e){ log('Errore proposte: '+e.message); }
  busy(false);
};

$('#btnGo').onclick = () => craft();

/* ── Conferma dell'idea ──
   Con la casella spuntata, craft() si ferma dopo aver scritto il prompt e mostra l'idea scelta:
   si può generare, chiedere un'altra idea (il modello riceve l'elenco di quelle rifiutate) o chiudere. */
let rejectedIdeas = [];
let lastProposal = null;   // { label } testo da ricordare se l'utente rifiuta la proposta

/* Lettura dell'articolo (tipo Blog): { argomento, tono, spirito } → testo breve, '' se manca */
function articleReading(j){
  const a = j && typeof j.articolo === 'object' && j.articolo ? j.articolo : null;
  if (!a) return '';
  return [['Argomento', a.argomento], ['Tono', a.tono], ['Spirito', a.spirito]]
    .filter(([, v]) => typeof v === 'string' && v.trim()).map(([k, v]) => `${k}: ${v.trim()}`).join(' · ');
}

function hideApproval(){ $('#approvalBox').classList.add('hidden'); }

function showApproval(j){
  const concept = typeof j.concept === 'string' ? j.concept.trim() : '';
  const skipped = Array.isArray(j.ovvie) ? j.ovvie.filter(x => typeof x === 'string').slice(0, 5) : [];
  $('#approvalConcept').textContent = concept || 'Il prompt è pronto: controllalo qui sotto prima di generare.';
  $('#approvalSkipped').textContent = skipped.length ? `Scartate: ${skipped.join(' · ')}` : '';
  $('#approvalArticle').textContent = articleReading(j);
  lastProposal = { label: concept || String(j.prompt).slice(0, 200) };
  const box = $('#approvalBox');
  box.classList.remove('hidden');
  box.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  $('#btnApprove').focus({ preventScroll: true });
}

$('#btnApprove').onclick = () => { hideApproval(); generate(); };
$('#btnAnother').onclick = () => { if (lastProposal) rejectedIdeas.push(lastProposal.label); craft({ again: true }); };
$('#btnApprovalClose').onclick = hideApproval;
$('#approveIdea').onchange = e => uiSet('approve', e.target.checked);

async function craft({ again = false } = {}){
  if (!again) rejectedIdeas = [];
  hideApproval();
  busy(true); log(again ? 'Cerco un\'altra idea…' : 'Il LLM scrive il prompt tecnico…');
  try {
    // l'elenco delle idee rifiutate va solo al modello: il testo del brief nella pagina non cambia
    const brief = $('#brief').value + (rejectedIdeas.length
      ? `\n\n[Proposte già fatte e rifiutate dall'utente: ${rejectedIdeas.map(x => `"${x}"`).join('; ')}. Proponi un'idea sostanzialmente diversa da tutte.]` : '');
    const messages = await buildTextRequest('prompt', brief);
    const j = await askJSON(messages);
    if (typeof j.prompt !== 'string' || !j.prompt.trim()) throw new Error('la risposta del modello non contiene il prompt');
    $('#promptOut').value = j.prompt;
    const reading = articleReading(j);
    if (reading) log(`📰 Lettura dell'articolo → ${reading}`);
    if (typeof j.concept === 'string' && j.concept.trim()) {
      const scartate = Array.isArray(j.ovvie) ? j.ovvie.filter(x => typeof x === 'string').slice(0, 3).join('; ') : '';
      log(`💡 Idea scelta: ${j.concept.trim()}${scartate ? ` (scartate: ${scartate})` : ''}`);
    }
    if ($('#approveIdea').checked) {
      log('Prompt pronto: attendo la tua conferma.');
      busy(false);          // prima si riabilitano i pulsanti, altrimenti il focus non può andare su "Genera"
      showApproval(j);
      return;
    }
    log('Prompt pronto. Genero…');
    await generate();
  } catch(e){ log('Errore craft: '+e.message); busy(false); }
}

/* Formato da chiedere al modello grafico con image_config (OpenRouter): solo i valori ammessi.
   Per le modifiche si cerca il valore ammesso più vicino alle proporzioni dell'immagine (entro il 2%). */
const ASPECT_RATIOS = ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'];
const aspectNoted = new Set();
function aspectFor(ratio){
  if (!$('#sendAspect').checked) return null;
  if (ASPECT_RATIOS.includes(ratio)) return ratio;
  if (!aspectNoted.has(ratio)) { aspectNoted.add(ratio); log(`Il formato ${ratio} non è tra quelli che OpenRouter accetta come parametro: resta solo nel prompt.`); }
  return null;
}
function aspectForSize(w, h){
  if (!$('#sendAspect').checked || !w || !h) return null;
  return ASPECT_RATIOS.find(a => Math.abs((w / h) / parseRatio(a) - 1) <= 0.02) || null;
}
function noteAspect(res, ratio){
  if (res.aspect === 'rifiutato' && !aspectNoted.has('rej:' + $('#imageModel').value)) {
    aspectNoted.add('rej:' + $('#imageModel').value);
    log(`Il modello grafico non accetta il parametro di formato: ho rigenerato senza (${ratio} resta nel prompt).`);
  }
}

$('#btnGen').onclick = () => generate();
$('#btnRe').onclick = () => generate('Small variation of the same concept, keep coherence: ');
async function generate(prefix=''){
  const prompt = prefix + $('#promptOut').value;
  if (!prompt.trim()) return log('Scrivi o genera prima un prompt.');
  busy(true); log(`Genero con ${$('#imageModel').value}…`);
  $('#stage').innerHTML = '<div class="spin"></div>';
  try {
    const refImages = getSelectedImageUrls();
    const styleRefs = styleRefImages(refImages);
    // le immagini di stile vanno in coda: la frase aggiunta al prompt le indica come «le ultime N»
    const fullPrompt = styleRefs.length ? `${prompt}\n\n${styleRefsSentence(styleRefs.length)}` : prompt;
    const ratio = $('#ratio').value;
    const r = await orFetch('/api/generate', { model: $('#imageModel').value, prompt: fullPrompt, referenceImages: [...refImages, ...styleRefs], aspectRatio: aspectFor(ratio) });
    noteAspect(r, ratio);
    showImage(r.images[0], { prompt });
    log('Immagine ricevuta ✔');
  } catch(e){
    const ph = document.createElement('div'); ph.className = 'placeholder'; ph.setAttribute('role', 'alert'); ph.textContent = e.message;
    $('#stage').replaceChildren(ph);
    log('Errore: '+e.message);
  }
  busy(false);
}
