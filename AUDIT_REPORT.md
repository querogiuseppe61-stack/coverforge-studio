# AUDIT_REPORT – CoverForge Studio v2.0.0

Data audit: 2026-10-15 · Modalità: sola lettura · Revisore: Claude (Sonnet 5.5)

Legenda: **[F]** = fatto verificato leggendo codice o output di comandi · **[da verificare]** = ipotesi plausibile, non confermata (serve eseguire l'app o consultare documentazione).
Nessun valore segreto è riportato in questo documento.

---

## 1. Panoramica

CoverForge Studio genera copertine, loghi, icone e header. Il flusso è: l'utente scrive un brief, un LLM (via OpenRouter) lo trasforma in un prompt tecnico in inglese, un modello grafico (via OpenRouter) produce l'immagine. Sopra l'immagine si può comporre una "mascherina" di testo (blocchi con font, colore, posizione) e scaricare il risultato.

- **Backend** `server.js` (272 righe): Express 4, SQLite via `better-sqlite3` (WAL), `multer` per gli upload. Funge da proxy verso OpenRouter (`/api/models`, `/api/craft`, `/api/generate`) e offre CRUD per cronologia (`history`) e file di riferimento (`reference_files`, con estrazione testo da txt/md/pdf/docx). Serve anche `public/` e `uploads/`. [F: server.js:1-272]
- **Frontend** `public/` (index.html 226 righe, app.js 735, index.css 959): JS vanilla, nessun framework. Se `/api/health` non risponde passa alla "modalità diretta" e chiama OpenRouter dal browser. [F: app.js:354-356, 369-382]
- **Shell desktop** `electron.js`: avvia `node server.js` come processo figlio, attende `/api/health`, apre `http://localhost:PORT`. Se il server non risponde carica `public/index.html` da file. [F: electron.js:13-26, 47-60]
- **Avvio**: `coverforge.sh` (Electron di default, `--web` per il browser), `coverforge-silent.sh` (wrapper di `--web`), `coverforge-studio.desktop` (lancia `coverforge.sh` in terminale).
- **Dati**: `coverforge.db` nella cartella del progetto; le immagini generate sono salvate in SQLite come stringhe base64 (colonna `history.image`). [F: server.js:17-30, 259-260]
- **Skill Prompt Master**: `/api/prompt-master` estrae sezioni da `prompt-master-main/` e il frontend le inietta nel system prompt. [F: server.js:162-196; app.js:526-530]
- Il file README è di 7 righe; non c'è `.gitignore` e la cartella non è un repository git. [F]

**Controlli passati senza problemi [F]:** tutte le query SQL usano parametri `?` (nessuna SQL injection); i nomi file su disco sono UUID generati dal server (server.js:51-54) e i percorsi sono ricostruiti da `stored_name` del DB, quindi nessun path traversal negli upload/cancellazioni; l'estensione è filtrata con whitelist e SVG non è ammesso; `node --check` passa su server.js, electron.js, app.js; `bash -n` passa su entrambi gli script; `uploads/` è vuota.

---

## 2. Bug e debolezze

Totale: **40** → Critica 1 · Alta 6 · Media 16 · Bassa 17.

### Critica

| ID | Gravità | File:riga | Problema | Scenario di fallimento | Correzione consigliata |
|---|---|---|---|---|---|
| C-01 | Critica | `.env.example:1` | [F] Il file di esempio contiene un valore con formato di chiave OpenRouter reale (prefisso `sk-or-v1-`, lunghezza completa) invece di un segnaposto. Se sia ancora valida: [da verificare]. `.env` ha la stessa dimensione (133 byte), quindi probabilmente è identico [ipotesi, ho letto solo i metadati]. Non c'è `.gitignore`. | Il progetto viene zippato, condiviso o pubblicato (GitHub, backup cloud, invio a un amico): la chiave esce con lui e chiunque può spendere i crediti. Il valore è inoltre comparso nel log di questa sessione. | Revocare la chiave dal pannello OpenRouter e crearne una nuova solo in `.env`. Sostituire in `.env.example` con `OPENROUTER_API_KEY=` vuoto. Creare `.gitignore` con `.env`, `*.db*`, `uploads/`, `node_modules/`, `*.log`, `*.pid`. |

### Alta

| ID | Gravità | File:riga | Problema | Scenario di fallimento | Correzione consigliata |
|---|---|---|---|---|---|
| A-01 | Alta | `server.js:273`; `151-157`, `198` | [F] `app.listen(PORT)` senza host: Node ascolta su tutte le interfacce. Nessuna autenticazione, nessun controllo di `Host`/`Origin`. Se `.env` ha una chiave, `hdrs()` la usa come fallback per qualunque richiesta. | Sul Wi-Fi di un bar o di un coworking, chiunque raggiunga la porta 3000 può chiamare `/api/generate` e `/api/craft` consumando i tuoi crediti, leggere/cancellare la cronologia e riempire il disco con upload da 50 MB. In più, un sito malevolo aperto nel tuo browser può caricare file via `multipart/form-data` (richiesta "semplice", senza preflight) su `localhost:3000`; il DNS rebinding è possibile perché l'`Host` non è verificato [da verificare]. | `app.listen(PORT, '127.0.0.1')`. Middleware che rifiuta richieste con `Host` diverso da `localhost:PORT`/`127.0.0.1:PORT` e `Origin` non coincidente sui metodi non-GET. Opzionale: token casuale generato all'avvio e passato a Electron. |
| A-02 | Alta | `public/app.js:446-451`, `591`; `server.js:233-237` | [F] Le immagini di riferimento selezionate sono inviate come percorso relativo (`/uploads/<uuid>.png`). Il server le inoltra tali e quali in `image_url.url`. OpenRouter non può risolvere un percorso locale. L'esito runtime è [da verificare], ma è quasi certo un errore 400. | Carichi una foto di riferimento, la spunti e premi "Genera": la richiesta fallisce o l'immagine è ignorata. La funzione "Riferimenti → immagine" non lavora. | Nel server, per ogni URL che inizia con `/uploads/`: validare con `path.basename`, verificare l'esistenza in `reference_files`, leggere il file e convertirlo in `data:<mime>;base64,…`. Rifiutare URL esterni arbitrari. |
| A-03 | Alta | `server.js:97`; `public/app.js:453-467` (in particolare `461`) | [F] `GET /api/ref-files` seleziona le colonne senza `extracted_text`. `buildRefContext()` legge `row.extracted_text` da quella risposta, quindi è sempre `undefined`. Nessun altro endpoint restituisce il testo. | Alleghi il tuo manoscritto o una scheda personaggi in PDF/DOCX/TXT, spunti il file: l'LLM non riceve mai il contenuto, ma l'interfaccia lascia credere di sì. La funzione chiave per uno scrittore non funziona. | Aggiungere `GET /api/ref-files/:id/text` (oppure includere il testo troncato a 4000 caratteri solo per gli id richiesti) e usarlo in `buildRefContext()`. |
| A-04 | Alta | `public/app.js:559`, `664-665`, `594`, `697`; `server.js:257-262` | [F] Dati non fidati finiscono in `innerHTML` senza escape: titolo/concept delle idee (output LLM), `row.category`, `row.brief`, `row.prompt`, `row.image` in `src="…"` (cronologia), `e.message` negli errori, `url` nell'`<img>`. `escapeHtml()` esiste (app.js:433) ma è usata solo per i file di riferimento e i blocchi maschera. | Un PDF scaricato da internet contiene testo con istruzioni nascoste (prompt injection): finisce nel system prompt (app.js:528-530), l'LLM risponde con `<img src=x onerror=…>` nel campo `concept`, e lo script gira nell'origine dell'app: legge `localStorage.or_key` e chiama le API locali. Lo stesso vale per qualunque processo locale o sito che faccia `POST /api/history` con un `image` costruito ad arte (stored XSS). | Usare `textContent`/`createElement` e `img.src = …` (con controllo che `image` inizi con `data:image/` o `https://`). Applicare `escapeHtml` a ogni interpolazione. Validare `image` e i campi nel server. Aggiungere un CSP (`default-src 'self'`; `img-src 'self' data: https:`). |
| A-05 | Alta | `server.js:254`; `public/app.js:656-675`, `695-728` | [F] `GET /api/history` fa `SELECT *` su 200 righe, ciascuna con un'immagine base64 (da centinaia di KB a più MB). Ogni `showImage()` salva una nuova riga e poi richiama `loadHistory()`, che riscarica tutto. Nessuna potatura: le righe vecchie restano per sempre. La lettura è sincrona (`better-sqlite3`) e blocca l'event loop durante serializzazione e invio. | Dopo alcune decine di generazioni (immagini da 2 MB) ogni nuova immagine fa trasferire e renderizzare centinaia di MB; l'interfaccia rallenta, il server non risponde ad altre richieste durante la query, il DB cresce senza limite. Con immagini > 30 MB di JSON il salvataggio fallisce in silenzio (`.catch(()=>{})`, app.js:727; limite 30 MB a server.js:10). | Salvare le immagini come file in una cartella dedicata (es. `data/generated/`) e in DB solo il nome. `GET /api/history` senza immagine (o con miniatura 200 px); immagine servita da `/api/history/:id/image`. Aggiungere paginazione e un limite configurabile (es. ultime 500). |
| A-06 | Alta | `public/index.css:394-416`, `727-736`; `public/app.js:186`, `194`, `205`, `232` | [F] L'overlay del testo è `position:absolute; inset:0` sull'intero `.stage` (largo quanto il pannello, `min-height:320px`), mentre l'immagine è centrata nello stage con `max-height:62vh`. Le coordinate X/Y in percentuale sono quindi relative allo stage, non all'immagine. L'export (`compositeMask`) usa invece percentuali dell'immagine e scala il font con `W/800` (app.js:232), mentre l'anteprima usa `px` fissi (app.js:205). L'effetto grafico è [da verificare] avviando l'app. | Posizioni e dimensioni del testo nell'anteprima non coincidono con il PNG scaricato (soprattutto con copertine 2:3, strette e alte). Sistemi il titolo nell'anteprima e il file esportato lo mostra altrove. | Racchiudere `img` e overlay in un wrapper `position:relative; display:inline-block` che ha le dimensioni dell'immagine; esprimere il font in unità relative (`cqw` o calcolo `size * imgWidth/800` in JS) con la stessa formula usata nel canvas. |

### Media

| ID | Gravità | File:riga | Problema | Scenario di fallimento | Correzione consigliata |
|---|---|---|---|---|---|
| M-01 | Media | `server.js:76-82` | [F] `require('pdf-parse')` viene chiamato come funzione (`await pdf(buf)`). Il lockfile indica `pdf-parse 2.4.5` (package-lock.json); la 2.x ha un'API a classe (`new PDFParse({data}).getText()`), non una funzione [da verificare nella documentazione del pacchetto]. L'errore è inghiottito da `catch { return ''; }`. | Tutti i PDF vengono salvati con testo vuoto senza alcun avviso. | Verificare con un PDF di prova; adeguare all'API 2.x; in caso di errore restituire un messaggio all'utente invece di una stringa vuota. |
| M-02 | Media | `public/app.js:354-360` | [F] La IIFE di avvio fa `await loadModels()` senza `try/catch`; `loadHistory()` e `loadRefFiles()` vengono dopo. | Offline, o OpenRouter lento/in errore: `loadModels` lancia, la promise è respinta (unhandled), cronologia e riferimenti non vengono mai caricati e i menu dei modelli restano vuoti, senza messaggio all'utente. | Avvolgere ciascuna chiamata in `try/catch` e mostrare un banner con pulsante "Riprova"; caricare i tre elenchi in parallelo con `Promise.allSettled`. |
| M-03 | Media | `public/app.js:241-267` (riga `246`) | [F] `const tw = m + pad * 2;` usa l'oggetto `TextMetrics` invece di `m.width`: il risultato è `NaN`, quindi `fillRect` non disegna. Inoltre `fillText` non va a capo sui `\n` (il campo `#mcText` è un `textarea` che promette "Invio = a capo", index.html:144), mentre l'anteprima usa `white-space: pre-wrap` (index.css:740). | Con "Sfondo" attivo (preset Header web) il PNG esportato non ha il riquadro scuro visibile in anteprima. Testo su due righe: nell'anteprima è su due righe, nell'export su una. | Usare `m.width`; dividere `txt.split('\n')` e disegnare riga per riga con interlinea. |
| M-04 | Media | `public/app.js:695-714` | [F] `showImage()` riscrive `#stage.innerHTML` e richiama `renderOverlay()` solo se `maskBlocks` è vuoto (dentro un `setTimeout`). Alla seconda immagine l'overlay è perso, ma `maskEnabled` resta `true`. Lo stesso accade al click sulla galleria (app.js:718). | La seconda generazione non mostra il testo, ma "Scarica" (app.js:611) lo applica comunque all'export: il file differisce da ciò che vedi. | Chiamare sempre `renderOverlay()` dopo aver messo l'immagine; rimuovere il `setTimeout`. |
| M-05 | Media | `server.js:59-67`, `101-123`; `public/app.js:493-496` | [F] Gli errori di `multer` (tipo non ammesso, file > 50 MB) non sono catturati: passano al gestore errori di default di Express, che risponde con una pagina HTML. Il client fa `await r.json()` e fallisce con "Unexpected token <". Se l'estrazione o l'INSERT lanciano, il file già scritto in `uploads/` resta orfano. | Trascini un `.exe` o un file troppo grande: nel log leggi un errore di parsing, non "Tipo file non supportato". Dopo errori ripetuti `uploads/` si riempie di file non referenziati. | Chiamare `upload.single('file')` in una funzione che gestisce l'errore e risponde JSON 400/413; nel `catch` fare `fs.unlink`. Controllare che i primi byte del file corrispondano al tipo dichiarato. |
| M-06 | Media | `server.js:126-144`, `257-266` (nessun middleware errori) | [F] Nessun gestore d'errore globale e `NODE_ENV` non impostato: Express risponde con lo stack trace, che contiene i percorsi assoluti. Gli endpoint della cronologia non validano gli input (`category` è `NOT NULL`, `image` accetta qualsiasi stringa); `unlinkSync` può lanciare. | Un `POST /api/history` senza `category` restituisce un 500 con stack e percorsi. | `app.use((err,req,res,next)=>res.status(500).json({error:'Errore interno'}))`; validare i corpi (tipi, lunghezze, prefisso `data:image/`). |
| M-07 | Media | `server.js:203`, `222`, `239`; `public/app.js:369-382` | [F] Nessun timeout, nessun `AbortController`, nessun retry/backoff, nessuna gestione esplicita di 429/5xx. `r.json()` lancia se la risposta non è JSON (es. 502 con HTML). | Il provider è lento o si blocca: la UI resta su "Genero…" con lo spinner per sempre; i pulsanti restano disabilitati (`busy(true)`) finché non ricarichi. | `AbortSignal.timeout(120000)` sulle chiamate; retry (max 2) su 429/502/503 con attesa crescente; messaggio chiaro per il 429; pulsante "Annulla". |
| M-08 | Media | `server.js:273`; `electron.js:62-67` | [F] Nessun gestore di `SIGINT`/`SIGTERM`, nessun `server.close()`, nessun `db.close()`. `serverProc.kill()` invia SIGTERM che termina il processo all'istante. Il DB ha `coverforge.db` di 4096 byte e il WAL da 1,2 MB (ls): i dati vivono nel WAL. | Una chiusura brusca è tollerata dalle transazioni di SQLite, ma un'operazione di scrittura in corso (upload + INSERT) può lasciare file orfani; un backup del solo `coverforge.db` perde la cronologia. | `process.on('SIGTERM'/'SIGINT', ...)` → chiudi server, `db.pragma('wal_checkpoint(TRUNCATE)')`, `db.close()`. Documentare il backup (`.backup` di SQLite o copia dei tre file). |
| M-09 | Media | `public/app.js:677-686` → `695-728` | [F] `restoreRow()` chiama `showImage()`, che in modalità proxy fa un nuovo `POST /api/history`. | Clicchi un elemento della cronologia per rivederlo: viene salvato un duplicato (con altro base64 completo), la lista cambia ordine e il DB cresce. | Separare `renderImage()` da `saveToHistory()`; la restore chiama solo la prima. |
| M-10 | Media | `public/index.html:122`, `126-217`; `public/app.js:321-322`, `709` | [F] Verifica automatica: 30 `id` dell'HTML non hanno alcun gestore in app.js: `btnMaskSave`, `btnMaskDelPreset`, `btnMaskExport/Import`, `btnMaskUploadImg`, `mcFont`, `mcLH`, `mcStroke*`, `mcGlow*`, `mcGrad*`, `btnMaskDup`, `btnMaskCopyStyle/Paste`, `btnMaskGroup/Ungroup`, `btnMaskFwd/Back`, `btnUndo/Redo`, `btnDlMaskPng/Svg`. `#maskPreset` non ha `<option>` (nessun codice le popola), quindi "Applica" legge `''` e non fa nulla. Il testo guida promette trascinamento, Shift+click, frecce, Ctrl+Z: in app.js non c'è alcun `keydown`/`mousedown`. | L'utente vede una ventina di controlli che non fanno nulla e istruzioni false. | O completare le funzioni (vedi sezione 4) o nascondere i controlli finché non esistono; popolare `#maskPreset` da `MASK_PRESETS`. |
| M-11 | Media | `coverforge.sh:75-92` | [F] Se la porta è già occupata (server precedente rimasto in vita) il nuovo `node server.js` esce con `EADDRINUSE`, ma `curl /api/health` risponde (dal vecchio server) e lo script stampa "Server pronto". Il PID salvato è quello del processo già morto. | Il vecchio server rimane vivo dopo il `Ctrl+C` (la cleanup uccide un PID inesistente) e non si riesce più ad avviare una versione aggiornata. | Prima dell'avvio controllare la porta (`ss -ltn "sport = :$PORT"`); se occupata, dirlo e uscire; verificare che `kill -0 $pid` sia ancora valido dopo il health-check. |
| M-12 | Media | `coverforge.sh:8`, `148`, `141-144`; `coverforge-silent.sh:3-6` | [F] `set -e` più `clear` (riga 148). Senza terminale/`TERM` `clear` restituisce un errore e lo script esce [da verificare]. Lo script "silent" invoca comunque `coverforge.sh --web`, che mostra il banner, apre `tail -f` e fa `wait`: non è silenzioso e non torna al prompt. | Lanciando `coverforge-silent.sh` da un launcher senza terminale parte il server oppure fallisce subito con un messaggio invisibile. | `[ -t 1 ] && clear`; in modalità silent: `nohup node server.js >> log 2>&1 &`, niente tail, apertura del browser e uscita. |
| M-13 | Media | `electron.js:48-52`, `15-18` | [F] `webPreferences` contiene solo `nodeIntegration:false`. Mancano `contextIsolation:true`, `sandbox:true`, un `setWindowOpenHandler`/`will-navigate` che blocchi domini esterni, un CSP e `app.requestSingleInstanceLock()`. Nelle versioni recenti di Electron `contextIsolation` e `sandbox` sono attivi di default [da verificare nella documentazione di Electron 44], quindi il rischio attuale è contenuto; ma è implicito. | Un link o un redirect esterno si apre dentro la finestra con accesso al localStorage dell'app. Due istanze di Electron avviano due server sulla stessa porta e la seconda muore con `EADDRINUSE`. | Impostare esplicitamente le opzioni, negare ogni navigazione fuori da `http://127.0.0.1:PORT`, aprire i link esterni con `shell.openExternal` (solo https), richiedere il lock di istanza singola. |
| M-14 | Media | `public/app.js:634-653` | [F] "⇪ SVG" invia l'intera immagine in base64 a `https://api.autotrace.org/v1/trace`. Non so se questo endpoint pubblico esista [da verificare]; il codice gestisce il fallimento con un messaggio. | La copertina di un libro inedito esce dal computer verso un servizio terzo, oppure la funzione non risponde mai. | Vettorializzazione locale (vedi sezione 4) oppure rimuovere il pulsante e dichiarare l'invio. |
| M-15 | Media | `public/app.js:92-94`, `298-299`, `558-560`, `667`, `414-416`; `public/index.html:222` | [F] Categorie, idee, voci di cronologia e blocchi maschera sono `div` con `onclick` senza `role`, senza `tabindex`, senza gestione di Invio/Spazio. La checkbox dei riferimenti ha solo `title`. Il log non è una regione `aria-live`. | Usando solo la tastiera non si può scegliere la categoria né aprire una proposta; uno screen reader non annuncia le notifiche. | Usare `<button>` per gli elementi cliccabili; `aria-live="polite"` sul log; `aria-label` sui controlli; `:focus-visible` anche sui bottoni. |
| M-16 | Media | `package.json:10-17` | [F] `npm audit`: 3 vulnerabilità moderate nella catena `mammoth → argparse → sprintf-js` (DoS per precisioni non limitate, GHSA-hp3w-g68c-fv3c). Nessuna critica/alta. La correzione proposta da npm (`--force`) installerebbe `mammoth@0.3.29` (downgrade con breaking change). L'effettiva raggiungibilità dal flusso `.docx` è [da verificare]. | Un DOCX costruito ad arte potrebbe bloccare l'estrazione (CPU). Rischio basso per un'app locale a un solo utente. | Non usare `audit fix --force`. Seguire gli avvisi di mammoth per una nuova release; nel frattempo applicare timeout e limite di dimensione ai `.docx`. |

### Bassa

| ID | Gravità | File:riga | Problema | Scenario di fallimento | Correzione consigliata |
|---|---|---|---|---|---|
| B-01 | Bassa | `coverforge.sh:13-14` | [F] Lo script usa `PORT` dall'ambiente (default 3000), mentre il server legge `PORT` da `.env` (dotenv). | Cambi `PORT` solo in `.env`: lo script interroga la porta sbagliata e dichiara "Server non avviato". | Leggere `PORT` con `grep '^PORT=' .env` (solo quella riga) oppure far stampare la porta al server. |
| B-02 | Bassa | `coverforge.sh:143` | [F] Il `trap` è impostato in fondo a `launch_web`, dopo l'avvio. | `Ctrl+C` durante l'attesa del server (righe 81-90) lascia il processo Node orfano. | Impostare il `trap` subito dopo la riga 77. |
| B-03 | Bassa | `public/app.js:283-284`, `371`; `public/index.html:30` | [F] La chiave API è salvata in chiaro in `localStorage` e inviata sia nell'header `x-or-key` sia nel body (`key`). Il campo è opzionale se esiste la chiave nel server. | Chi ha accesso al profilo Electron può leggerla; un XSS (A-04) la esfiltra. | Tenere la chiave solo lato server (`.env`) o cifrarla con `safeStorage` di Electron; inviarla in un solo punto. |
| B-04 | Bassa | `public/index.html:7-9`; `public/index.css:5` | [F] I font vengono caricati da Google Fonts. | Offline i font di fallback alterano layout e canvas (`Inter, sans-serif`, app.js:235); in più ogni avvio contatta Google. | Includere i `.woff2` in `public/fonts/` e usare `@font-face`. |
| B-05 | Bassa | `public/app.js:543`, `555-557` | [F] `extractJSON` cerca `{…}` con regex greedy; se il modello risponde senza JSON, `match` è `null` e l'errore mostrato è "Cannot read properties of null". `ideas.forEach` presume l'array. | L'LLM risponde in prosa: il messaggio d'errore non è comprensibile. | `try/catch` con messaggio "Risposta non valida, riprovo", un retry automatico e, dove supportato, `response_format: json_object`. |
| B-06 | Bassa | `server.js:159`, `202-215` | [F] La cache dei modelli è globale e ignora la chiave; la prima risposta vale per 5 minuti per tutti. | Poco rilevante in uso singolo; nota per futuro multi-utente. | Chiave di cache = hash della chiave, oppure cache solo per la chiave del server. |
| B-07 | Bassa | `electron.js:53-58` | [F] Dopo un massimo di circa 10 s di attesa (40 tentativi × 250 ms) senza server, la finestra passa in silenzio a `file://` (modalità diretta). La finestra è bianca durante l'attesa. | Server non partito: l'utente si ritrova in modalità diretta senza cronologia né riferimenti e senza capire perché. | Pagina di caricamento e, in caso di fallimento, finestra di errore con il log e un pulsante "Riprova". |
| B-08 | Bassa | `server.js:14-15`, `46` | [F] DB e upload stanno nella cartella dell'applicazione. | Spostando/aggiornando la cartella si perdono i dati; il backup del solo `.db` è incompleto (vedi M-08). | Cartella dati configurabile (`DATA_DIR`, default `~/.local/share/coverforge`; in Electron `app.getPath('userData')`). |
| B-09 | Bassa | `package.json` | [F] Mancano `engines`, `"private": true`, `license`, script `check`/`test`. Il codice usa `fetch` globale (Node ≥ 18). Node installato: v26.10.0, `npm` 11.19.1. | Su una macchina con Node vecchio: `fetch is not defined` al primo uso. | Aggiungere `"engines": {"node": ">=20"}` e lo script `check` (`node --check`). |
| B-10 | Bassa | `coverforge-studio.desktop:3,7,8,9` | [F] `desktop-file-validate` segnala: `Version=2.0` non valido (è la versione della specifica, 1.0 o 1.5); più categorie principali (compare due volte nel menu). Percorsi assoluti `/home/pippo/…`; `Terminal=true` lascia il terminale aperto. | Spostando la cartella il lanciatore smette di funzionare. | `Version=1.0`, `Categories=Graphics;`; generare il file con uno script `install-desktop.sh` che inserisce il percorso corrente (ed eventualmente `Terminal=false` con `coverforge-silent.sh` corretto). |
| B-11 | Bassa | `server.js:17-43`, `254` | [F] Nessun indice su `history.ts` né su `reference_files.ts`; nessun `PRAGMA user_version` per le migrazioni. | Con migliaia di righe `ORDER BY ts DESC` rallenta; una modifica futura dello schema richiede lavoro manuale. | `CREATE INDEX IF NOT EXISTS idx_history_ts ON history(ts)`; gestire `user_version`. |
| B-12 | Bassa | `server.js:59-67`, `147` | [F] Il tipo di file è verificato solo dall'estensione; `/uploads` è servito con `express.static` senza `X-Content-Type-Options: nosniff`. | Un file con estensione `.png` ma contenuto diverso viene accettato. | Controllare i magic bytes; aggiungere `nosniff` e `Content-Disposition` per i non-immagini. |
| B-13 | Bassa | `public/app.js:164`, `201-202`, `387-388` | [F] Codice morto: `alignMap`/`base` mai usati, parametro `onChange` inutilizzato; `applyMaskPreset` fa uno spread ridondante. Modelli predefiniti hard-coded (`anthropic/claude-sonnet-4.5`, `google/gemini-2.5-flash-image-preview`): se non esistono più, il default cade sul primo della lista. | Nessun errore, solo manutenzione e scelta iniziale poco chiara. | Pulire; salvare in `localStorage` gli ultimi modelli usati. |
| B-14 | Bassa | `coverforge.sh:74`; `electron.js:16` | [F] `rm -f "$LOG_FILE"` a ogni avvio (log precedente perso); in modalità Electron il log non viene scritto su file (`stdio:'inherit'`). | Se l'app fallisce dopo l'avvio non resta traccia da consultare. | Appendere con rotazione semplice (`.1`) e inviare lo stdout del server a `coverforge.log` anche da Electron. |
| B-15 | Bassa | `public/app.js:349-351`, `615-616`, `630` | [F] `URL.revokeObjectURL(a.href)` subito dopo `a.click()`. In alcuni browser può annullare il download [da verificare in Electron]. Il codice di export è duplicato in tre punti. | Download vuoto/interrotto in rari casi. | `setTimeout(() => URL.revokeObjectURL(url), 1000)` e una sola funzione `saveBlob()`. |
| B-16 | Bassa | `server.js:74`, `79`, `87`, `128-131` | [F] `readFileSync`/`unlinkSync` su file fino a 50 MB nell'event loop. | Con PDF/TXT grandi il server non risponde per qualche istante. | Versioni asincrone (`fs.promises`) e limite dimensione per l'estrazione. |
| B-17 | Bassa | `server.js:9-11` | [F] Nessun header di sicurezza (`X-Powered-By` attivo, nessun CSP, nessun `X-Frame-Options`); `express.json({limit:'30mb'})` vale per tutte le rotte. | Superficie d'attacco più ampia del necessario. | `app.disable('x-powered-by')`, CSP, limite alto solo per `/api/generate` e `/api/history`. |

---

## 3. Miglioramenti

| # | Miglioramento | Impatto | Sforzo |
|---|---|---|---|
| 1 | Rotazione chiave, `.env.example` pulito, `.gitignore` (C-01) | Alto | S |
| 2 | Bind su `127.0.0.1` + controllo `Host`/`Origin` (A-01) | Alto | S |
| 3 | Escape sistematico dell'HTML e CSP (A-04) | Alto | S |
| 4 | Riparare i riferimenti: immagini come data URL lato server, testo estratto disponibile all'LLM, adeguare l'API di `pdf-parse` (A-02, A-03, M-01) | Alto | M |
| 5 | Cronologia leggera: immagini su file, lista con miniature, paginazione, niente duplicati alla restore, indice su `ts` (A-05, M-09, B-11) | Alto | M |
| 6 | Allineare anteprima ed export della mascherina (wrapper dell'immagine, scala del font condivisa, sfondo, righe multiple) (A-06, M-03, M-04) | Alto | M |
| 7 | Timeout, retry con backoff, annullamento delle richieste, messaggi chiari su 429/5xx (M-07) | Medio | M |
| 8 | Gestione errori JSON globale, validazione input, errori multer leggibili (M-05, M-06) | Medio | S |
| 9 | Chiusura pulita: SIGTERM/SIGINT, `wal_checkpoint`, `db.close()` (M-08) | Medio | S |
| 10 | Avvio in `try/catch` e in parallelo, banner "offline / riprova" (M-02) | Medio | S |
| 11 | Launcher: controllo porta, trap anticipato, `clear` solo con TTY, `silent` davvero silenzioso, `PORT` da `.env`, generazione del `.desktop` (M-11, M-12, B-01, B-02, B-10) | Medio | S |
| 12 | Hardening Electron esplicito (`contextIsolation`, `sandbox`, blocco navigazione, istanza singola) e schermata di caricamento/errore (M-13, B-07) | Medio | S |
| 13 | Accessibilità: `<button>` al posto dei `div` cliccabili, `aria-live`, `:focus-visible` (M-15) | Medio | S |
| 14 | Rimuovere o completare i 30 controlli non collegati e popolare `#maskPreset` (M-10) | Medio | M |
| 15 | Font locali e dati in cartella dedicata (`DATA_DIR`) (B-04, B-08) | Basso | S |
| 16 | `engines`, script `check`, test di fumo con `node --test` sulle API (con DB temporaneo) (B-09) | Basso | M |
| 17 | Salvare modelli, categoria e stile scelti in `localStorage`; ricerca nel menu dei modelli (centinaia di voci in un `<select>`) (B-13) | Basso | S |
| 18 | README completo: requisiti (Node ≥ 20), configurazione, backup, risoluzione problemi | Basso | S |

---

## 4. Nuove funzioni

Tutte coerenti con l'uso reale (copertine di libri, album, loghi, header) e realizzabili in JS vanilla.

1. **Preset di formato per piattaforma e controllo pre-pubblicazione**
   - Valore: esportare in un clic nelle misure di KDP/Kobo/Apple Books, Spotify/Bandcamp, favicon, Open Graph; avvisare se la risoluzione è insufficiente.
   - Approccio: tabella JSON di formati in `public/`, ridimensionamento con `canvas` (già usato), controllo `naturalWidth/Height`.
   - Sforzo: **M**.

2. **Anteprima in miniatura (test di leggibilità)**
   - Valore: vedere la copertina a 80-150 px come sugli store, per capire se titolo e autore si leggono.
   - Approccio: pannello con la stessa immagine composita ridotta in `canvas`, aggiornata a ogni modifica.
   - Sforzo: **S**.

3. **Dal manoscritto al brief**
   - Valore: caricare il file del romanzo o la sinossi e ottenere automaticamente 3 concept (generi, ambientazioni, simboli, palette) senza riscrivere il brief a mano.
   - Approccio: riusa `extracted_text` (dopo la correzione A-03), prompt a due passaggi (riassunto → concept), nessuna dipendenza nuova.
   - Sforzo: **M**.

4. **Varianti multiple e preferiti**
   - Valore: generare 3-4 varianti in parallelo, confrontarle affiancate e segnare le migliori in cronologia.
   - Approccio: più chiamate a `/api/generate` con `Promise.allSettled`, griglia di scelta, colonna `favorite` in `history` (migrazione con `user_version`).
   - Sforzo: **M**.

5. **Contatore costi per sessione e per mese**
   - Valore: sapere quanto si spende sui crediti OpenRouter, mostrare il costo stimato prima di generare.
   - Approccio: l'elenco modelli di OpenRouter include i prezzi (campo `pricing`) [da verificare]; sommare per richiesta e salvare in una tabella `usage`.
   - Sforzo: **M**.

6. **Mascherina completa e preset personali**
   - Valore: stroke, glow, gradiente, font, interlinea, trascinamento dei blocchi sull'immagine, undo/redo, salvataggio/import-export JSON dei preset: sono già disegnati nell'HTML ma non funzionano.
   - Approccio: terminare ciò che la UI già promette (M-10), con font locali e stato in un unico oggetto con cronologia per undo.
   - Sforzo: **L**.

7. **Vettorializzazione locale per loghi e icone**
   - Valore: SVG pulito senza inviare nulla a terzi (M-14).
   - Approccio: libreria singola in JS puro (es. `imagetracerjs`, ~1 file) o chiamata a `potrace` se installato; riduzione colori prima del tracciato.
   - Sforzo: **M**.

8. **Esporta/importa progetto**
   - Valore: salvare un progetto (immagine, prompt, mascherina, impostazioni) in un unico file e riaprirlo su un altro computer o archiviarlo con il libro.
   - Approccio: JSON + immagine in un archivio ZIP prodotto lato server, endpoint di import con le stesse validazioni degli upload.
   - Sforzo: **M**.

---

## 5. Piano d'azione (primi 5 interventi)

1. **Revocare la chiave OpenRouter, ripulire `.env.example`, creare `.gitignore`** (C-01). Pochi minuti, azione manuale sul sito del provider.
2. **Legare il server a `127.0.0.1` e verificare `Host`/`Origin`** (A-01). Cambia una riga più un piccolo middleware.
3. **Escape/`textContent` ovunque ci sia `innerHTML` con dati esterni, più CSP** (A-04), e validazione dei campi in `POST /api/history`.
4. **Riparare i riferimenti** (A-02, A-03, M-01): data URL lato server per le immagini, endpoint per il testo estratto, verifica dell'API di `pdf-parse`. Sono le funzioni più utili per uno scrittore e oggi non funzionano.
5. **Cronologia leggera** (A-05, M-09): immagini su file, elenco con miniature, niente duplicati alla restore, indice su `ts`. Subito dopo: allineare anteprima ed export della mascherina (A-06, M-03, M-04).

---

## 6. Limiti dell'analisi

- **Non ho avviato l'app** (richiesto di chiedere prima): i comportamenti a runtime (esito delle immagini di riferimento verso OpenRouter, resa visiva dell'overlay, `clear` senza TTY, avvio di Electron) sono dedotti dal codice e segnati [da verificare] dove incerti.
- **Non ho letto `.env`** (come da regola): ho visto solo le dimensioni e i permessi. L'uguaglianza con `.env.example` è un'ipotesi. Non so se la chiave sia valida. Ho dovuto leggere `.env.example` (richiesto dal brief) e ne ho visto il valore; non è riportato qui.
- **Non ho aperto** `coverforge.db*`, `uploads/`, `node_modules/`, `prompt-master-main/`. Quindi: lo schema reale del DB è dedotto da `server.js:16-43`; non so se i marcatori usati da `extractSection` (server.js:181-187) esistano nei file della skill; non ho verificato l'API di `pdf-parse` 2.4.5 direttamente nel pacchetto.
- **Rete**: `npm audit` ha interrogato il registro npm (comando consentito). Non ho eseguito `npm outdated`, `npm install`, né verificato l'esistenza dell'endpoint `api.autotrace.org`.
- **Electron**: i default di sicurezza della v44 sono citati dalla conoscenza generale, non verificati nella documentazione. Non ho controllato il sandbox SUID di Chromium sul tuo sistema.
- **shellcheck non è installato**: gli script `.sh` sono stati controllati solo con `bash -n` e lettura manuale. `desktop-file-validate` è stato eseguito.
- **CSS e accessibilità**: ho esaminato le regole di stage, overlay, focus; non ho verificato i contrasti né la resa su schermi piccoli.
- L'audit (sezioni 1-6) è stato svolto in sola lettura; le correzioni successive sono elencate qui sotto.

---

## 7. Stato degli interventi (aggiornato 2026-10-16)

| ID | Stato | Note |
|---|---|---|
| C-01 | Risolto | `.env.example` ripulito, `.gitignore` creato; la vecchia chiave è stata revocata (confermato dall'utente il 2026-10-16). |
| A-01 | Risolto | Bind su `127.0.0.1`, controllo `Host`/`Origin`, CSP e `nosniff` (server.js). |
| A-02, A-03 | Risolti | Immagini di riferimento convertite in data URL lato server; testo estratto via `GET /api/ref-files/:id/text`. |
| M-01 | Risolto | `pdf-parse` 2.x usato con l'API a classe; avviso se non si estrae testo. Verificato con un PDF di prova. |
| A-04 | Risolto | `innerHTML` sostituito con costruzione DOM per tutti i dati non fidati; validazione di `POST /api/history`. |
| A-05, M-09, B-11 | Risolti | Immagini su disco (`generated/`), elenco leggero, limite 500 voci, nessun duplicato al ripristino, indice su `ts`. |
| A-06, M-03, M-04 | Risolti | Anteprima ed export con la stessa geometria (scarto massimo ~3 px su 1600 px), sfondo, righe multiple, overlay mantenuto sulle nuove immagini. |
| M-10 | Risolto | Tutti i controlli della mascherina collegati (nuovo file `public/mask.js`): font, interlinea, contorno, glow, gradiente, trascinamento, selezione multipla, gruppi, duplica, z-order, copia/incolla stile, annulla/ripeti, preset personali, import/export JSON, immagine di base, PNG e SVG del solo testo. |
| M-02 | Risolto | Cronologia, riferimenti e modelli si caricano in modo indipendente; se i modelli falliscono, nuovo tentativo automatico ogni 15 s (3 volte). Corretto anche il caricamento modelli in modalità diretta (GET con corpo). |
| M-05, M-06 | Risolti | Errori di upload, JSON malformato, corpo troppo grande ed endpoint inesistenti rispondono sempre in JSON leggibile; il file caricato non resta orfano se l'elaborazione fallisce; niente più stack trace al client. |
| M-07 | Risolto | Timeout per tipo di richiesta, retry con attesa crescente su rete/429/502-504 (la generazione immagini si ritenta solo su 429 e rete), messaggi specifici per 401/402/429, pulsante Annulla che interrompe anche la richiesta verso OpenRouter. |
| M-08 | Risolto | Chiusura pulita su SIGINT/SIGTERM/SIGHUP: attende le richieste in corso, checkpoint del WAL e `db.close()`; messaggio chiaro se la porta è occupata. Dopo la chiusura resta solo `coverforge.db`. |
| M-11, M-12, B-01, B-02 | Risolti | `coverforge.sh` riscritto: controllo porta, riuso dell'istanza attiva, verifica che il processo sia vivo durante l'attesa, trap anticipato, `clear` solo con terminale, `PORT` da `.env`, nuove opzioni `--silent` e `--stop`. |
| B-09, B-10, B-14 | Risolti | `engines`, `private` e script `check` in package.json; `.desktop` valido (generato da `install-desktop.sh`); log con rotazione a 1 MB e log anche in modalità Electron. |
| M-13, B-07 | Risolti | Electron: `contextIsolation`, `sandbox`, `webSecurity` espliciti; link esterni al browser di sistema, navigazione e nuove finestre bloccate, permessi negati; istanza singola; schermata di caricamento; se il server non parte, finestra con log e scelte (dopo ~5 s, non 40). Verificato con Electron reale. |
| M-14 | Risolto | Vettorializzazione locale (`public/trace.js`): niente più invio dell'immagine a servizi esterni; CSP ristretto a `connect-src 'self'`. |
| M-15 | Risolto (parziale) | Categorie, idee, cronologia e galleria da tastiera con `role`/`aria-pressed`; log `aria-live`; etichette ai campi; errori con `role="alert"`. Contrasti dei colori non verificati. |
| M-16 | Verificato, non sfruttabile | `argparse`/`sprintf-js` sono usati solo da `mammoth/bin/mammoth` (riga di comando), non dalla libreria. Nessuna correzione disponibile se non il downgrade; aggiunti limite di 25 MB e timeout di 30 s sull'estrazione di PDF/DOCX. |
| B-03 | Risolto | Chiave inviata solo nell'intestazione; salvata nel browser solo con "Ricorda la chiave". |
| B-05 | Risolto | Lettura JSON robusta (primo oggetto bilanciato) e un secondo tentativo automatico. |
| B-06 | Risolto | Cache modelli per chiave. |
| B-08 | Risolto | `DATA_DIR` per spostare database, upload e immagini; WAL riportato nel `.db` alla chiusura. |
| B-12 | Risolto | Controllo dei primi byte per ogni tipo di file (anche per la cronologia); non-immagini servite come download. |
| B-13 | Risolto | Modelli, tipo di progetto, formato e stile ricordati tra una sessione e l'altra. |
| B-15, B-16, B-17 | Risolti | Unica funzione di salvataggio con rilascio ritardato; I/O di file asincrono; `x-powered-by` rimosso, `Referrer-Policy`, limite JSON 2 MB (30 MB solo per generazione e cronologia). |
| B-04 | Risolto | 12 famiglie incluse in `public/fonts/` (24 file woff2, 799 KB, sottoinsiemi latin e latin-ext, scaricati da Google Fonts il 2026-10-16); CSP ristretto a `font-src 'self'`. Verificato: nessuna richiesta esterna, font variabili e `latin-ext` a richiesta. |

Nuova funzione: pulsante **Verifica connessione** (`GET /api/check`): controlla raggiungibilità di OpenRouter e validità della chiave, con i dati di spesa; funziona anche in modalità diretta. **Correzione del 2026-10-16**: la prima versione mostrava `limit_remaining` di `/key` come "credito residuo", ma quel campo è il limite di spesa della singola chiave, non il saldo del conto; il saldo sta in `/credits` (solo management key). Ora l'app prova `/credits` e, se non è leggibile, lo dice e mostra limite e spesa della chiave con la dicitura corretta. Provato con un OpenRouter simulato (chiave buona, senza limite, piano gratuito, revocata, vecchio endpoint, errore 500, nessuna risposta, rete assente) e con quello vero usando una chiave finta. Il caso "chiave valida" sull'OpenRouter reale è stato provato dall'utente: è così che è emerso l'errore sopra.

Nessuna voce aperta.

### Riferimenti e guida per il prompt (2026-10-16)

Domanda dell'utente: file allegati e skill hanno davvero effetto? Verifica sul codice: sì, entrambi arrivano al modello, ma i testi ne vedevano solo i primi 4000 caratteri, le immagini non raggiungevano il modello che scrive il prompt, e la skill originale (circa 4000 caratteri, il 4% di `SKILL.md`) conteneva sintassi di Midjourney e un invito ad "allegare l'immagine allo strumento". Interventi:

| Cosa | Esito |
|---|---|
| Testo dei riferimenti | Limite regolabile (da 2.000 a 32.000 caratteri per file), campionamento inizio/metà/fine su tutto il documento (si conservano fino a 500.000 caratteri), tetto di 60.000 per richiesta, intestazione che dice se è un estratto. |
| Immagini | Se il modello di testo ha la vista (👁) le riceve ridotte (max 3, 768 px, JPEG); il prompt di sistema dice al modello cosa vede e cosa no. Il server valida i messaggi: ruoli noti, solo immagini raster incorporate, massimo 3. |
| Guida | Nuova guida adatta all'app (`prompt-guide/cover-forge.md`, modificabile, sezioni per tipo di progetto), selettore *CoverForge / Prompt Master / Nessuna* al posto della casella; la vecchia preferenza viene migrata. |
| Collaterale | In modalità diretta l'elenco dei modelli non veniva interpretato (mancava la divisione testo/immagine): corretto. |

Non misurato: quanto il modello rispetti davvero la guida (serve provarla con un modello reale e confrontare i prompt).

**Verifica dell'utente sulla guida CoverForge (2026-10-16).** Tre prove con lo stesso brief ("antologia di racconti disturbanti e violenti", libro 2:3): nella versione 1 della guida il modello ha seguito alla lettera le indicazioni ("terzo superiore completamente vuoto", "forme semplici", "un'idea sola") e il risultato è stato giudicato il meno brillante, troppo vuoto e minimale; senza guida il prompt era più ricco; con la skill originale il prompt si chiudeva con "Negative prompts: …", testo inutile per un generatore conversazionale. La guida è stata riscritta (versione 2): ricchezza di dettaglio incoraggiata, zona calma per il titolo ma non vuota, minimalismo solo per logo e icona; la versione 1 è conservata in `prompt-guide/cover-forge.v1-minimale.bak`. Da riprovare con lo stesso brief.

**Esito delle prove sulla guida v2 (2026-10-16, giudizio dell'utente).** Antologia horror: CoverForge la più elegante, senza guida la più inquietante, Prompt Master simile alla prova precedente. Romanzo medievale con mistero: senza guida e Prompt Master molto simili e "banalotte", CoverForge elegante e la migliore. Decisione: la v2 resta la guida predefinita e non viene modificata. Possibile ritocco futuro, solo se servirà: una regola che faccia prevalere il disagio sull'eleganza quando il brief è cupo o violento.

**Terzo brief (saggistica, 2026-10-16).** Trattato sull'IA nell'industria: giudizio dell'utente "nessuna guida" la migliore, CoverForge e Prompt Master simili e scontate. Dai prompt in cronologia: CoverForge v2 aveva reso il tema alla lettera (robot in fabbrica, "industrial photography"), mentre senza guida il modello aveva scelto un trattamento grafico (isometrico, vettoriale); Prompt Master ha di nuovo scritto parametri Midjourney (`--ar 2:3 --v 6 --style raw --no …`), come già nella prova del medievale. Guida v3: nella sezione "libro" una regola per la saggistica (metafora visiva o trattamento grafico, non illustrazione letterale; scartare le immagini ovvie del tema), con esempi generici e non legati al brief di prova. Versioni precedenti in `prompt-guide/cover-forge.v1-minimale.bak` e `cover-forge.v2.bak`.

**Prove sulla guida v3 (2026-10-16, giudizio dell'utente).** "IA nell'industria" con CoverForge: immagine molto simile alla precedente (la regola sulla saggistica, scritta in una guida lunga, non ha cambiato il comportamento del modello); "storia dei canali idrici nel ferrarese": tornata l'eleganza dei primi due test. Intervento: con la guida CoverForge il modello deve ora compilare tre campi in ordine (`ovvie`, `concept`, `prompt`): prima scrive le immagini più prevedibili per il tema, poi l'idea scelta (diversa dalle ovvie), poi il prompt. L'idea scelta e quelle scartate compaiono nel registro. Con "Nessuna" e "Prompt Master" lo schema resta quello di prima, così il confronto rimane pulito. Da verificare con un modello reale.

**Prova con il campo `ovvie` (2026-10-16).** Brief "IA nell'industria": il modello ha scartato le tre immagini letterali elencate (robot su catena di montaggio, cervello con circuiti, fabbrica con ologrammi) e ha scelto "mano umana e mano robotica che si sfiorano su metallo brunito": un cliché metaforico tra i più comuni. Intervento: lo schema chiede ora 5 immagini ovvie, comprese le metafore più usate dall'editoria (due mani che si toccano, uomo contro macchina, mezzo volto e mezzo circuito, lampadina, scalata, bivio, bilancia), e per la saggistica preferisce un oggetto, un gesto o un luogo concreti a una metafora astratta. Esempi generici, non legati al brief di prova.

**Prova con lo schema più esigente (2026-10-16).** Brief "IA nell'industria": il modello ha scartato per iscritto anche le due mani ("Creazione di Michelangelo") e ha scelto un oggetto concreto, un tornio d'epoca in ottone e ghisa che modella da solo una forma organica. Nuova funzione richiesta dall'utente: *Conferma l'idea prima di generare* (casella ricordata tra le sessioni; spenta di default). Se accesa, craft() si ferma dopo il prompt e mostra l'idea; pulsanti Genera / Altra idea / Chiudi; "Altra idea" passa al modello l'elenco delle proposte rifiutate (azzerato a ogni nuova richiesta) e non cambia il testo del brief nella pagina. Funziona anche con le altre guide (senza idea né scartate). Provata su un modello simulato: nessuna generazione finché non si approva, una sola dopo l'approvazione, focus sul pulsante principale, nessun errore.

**Istruzione sui testi allegati per tipo di progetto (2026-10-16).** La frase che dice al modello come leggere i testi di riferimento era unica e narrativa ("personaggi, ambientazione, atmosfera e simboli"). Ora dipende dal tipo di progetto (libro, album, logo, icona, header) ed è definita in `REF_TEXT_HINT` in `public/app.js`, non nella guida, quindi vale con qualunque guida (CoverForge, Prompt Master, Nessuna) e il confronto fra le tre resta pulito. Provata su un modello simulato: la frase giusta compare per ogni tipo, sia per il prompt sia per le idee, non compare senza riferimenti spuntati, e la vecchia frase non resta. Da valutare con testi veri (brief di marca, testi di canzoni).

