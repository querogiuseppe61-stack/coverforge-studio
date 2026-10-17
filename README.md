# CoverForge Studio

Copertine, loghi, icone, header e immagini per articoli di blog: scrivi un brief, un LLM scrive il prompt, un modello grafico genera l'immagine (via OpenRouter). Sopra l'immagine puoi comporre testo con la mascherina ed esportare PNG/JPEG/WebP, oppure il solo testo in PNG o SVG.

Richiede **Node.js 20.3 o successivo**.

## Primo avvio

```bash
npm install
cp .env.example .env     # inserisci la tua chiave OpenRouter in OPENROUTER_API_KEY
```

La chiave può anche essere scritta nel campo "Chiave API" dell'interfaccia: viene ricordata nel browser solo se spunti "Ricorda la chiave", e viaggia solo verso il server locale. Il file `.env` non va mai condiviso né messo in un repository. Il pulsante **Verifica connessione** (nelle impostazioni) controlla che OpenRouter sia raggiungibile e che la chiave funzioni, e mostra i dati di spesa. Il saldo del conto lo legge solo una *management key* di OpenRouter; con una chiave normale vedi il limite di spesa impostato sulla chiave (se c'è) e quanto hai speso con essa, mentre il saldo si controlla nella pagina Credits dell'account su openrouter.ai.

## Avvio

```bash
bash coverforge.sh              # finestra Electron se installato, altrimenti browser
bash coverforge.sh --web        # server + browser; Ctrl+C ferma tutto
bash coverforge.sh --electron   # solo la finestra Electron
bash coverforge.sh --silent     # server in background + browser, senza bisogno di un terminale
bash coverforge.sh --stop       # ferma il server avviato con --silent o --web
```

Oppure `npm start` (solo server, http://localhost:3000) e `npm run electron`.

La finestra Electron è una sola alla volta, non apre mai pagine esterne al suo interno (i link vanno al browser di sistema) e nega tutti i permessi del browser. Se il server non parte mostra una finestra con le ultime righe del log e le scelte *Riprova / Apri il log / Modalità diretta / Esci*.

- Se l'app è già in esecuzione, `--web` e `--silent` la riutilizzano invece di avviarne un'altra.
- Se la porta è occupata da un altro programma lo script lo dice e non tocca nulla: cambia `PORT` in `.env`.
- Il server ascolta solo su `127.0.0.1`.
- Il log è in `coverforge.log` (ruotato a 1 MB, la copia precedente è `coverforge.log.1`).

### Icona nel menu / doppio clic

```bash
bash install-desktop.sh          # rigenera coverforge-studio.desktop con il percorso attuale
bash install-desktop.sh --menu   # in più lo aggiunge al menu delle applicazioni
```

Rilancialo se sposti la cartella del progetto.

## Riferimenti e guida per il prompt

- **File di testo** (txt, md, PDF, DOCX): spunta quelli da usare. Il testo va al modello che scrive il prompt, che ne ricava personaggi, ambientazione, atmosfera e simboli. Per ogni file si usano al più i caratteri scelti in *Testo da usare per ogni file* (da circa 1 a 16 pagine); se il file è più lungo si prendono **inizio, metà e fine**, non solo l'apertura. In totale non si superano 60.000 caratteri per richiesta. Nel registro compare cosa è stato usato.
- **Come vengono letti i testi dipende dal tipo di progetto**: per un libro (narrativa: personaggi, ambientazione, atmosfera, simboli; saggio: tema, tesi, tono), per un album (temi, emozioni, immagini poetiche, sonorità), per un logo (cosa fa la marca, pubblico, valori, tono, indicazioni su colori e forme), per un'icona (la funzione principale, un solo concetto), per un header (argomento e tono dell'articolo o del sito), per il blog (vedi sotto). Cosa allegare: libro → capitoli, racconti o una sinossi; album → testi delle canzoni e note sul disco; logo → brief di marca o linee guida in PDF/DOCX; icona → descrizione dell'app; header → il testo dell'articolo; blog → l'articolo completo.
- **Immagini**: vanno sempre al generatore, insieme al prompt. Se il modello di testo ha la vista (segnato con 👁 nell'elenco) le riceve anche lui, ridotte, e ne tiene conto scrivendo il prompt; altrimenti il prompt viene scritto senza vederle e include solo una frase che chiede al generatore di usarle come riferimento.
- **Conferma dell'idea**: con la casella *Conferma l'idea prima di generare* l'app, dopo aver scritto il prompt, si ferma e mostra l'idea scelta (con la guida CoverForge anche le immagini ovvie scartate). Puoi *Generare*, chiedere *Altra idea* (il modello riceve l'elenco di quelle rifiutate, senza ripeterle) oppure *Chiudere* e correggere a mano il prompt. Così non spendi crediti d'immagine su idee che non ti convincono.
- **Guida per il prompt**: *CoverForge* (predefinita) è un file tuo, `prompt-guide/cover-forge.md`: istruzioni generali, una sezione per tipo di progetto (libro, album, logo, icona, header), una per testo sì/no e una per i riferimenti; si usano solo le sezioni pertinenti e puoi modificarla senza riavviare. *Prompt Master (originale)* usa gli estratti di `prompt-master-main/`, scritti per Midjourney e simili; *Nessuna* non aggiunge nulla.

## Immagine principale per articoli di blog

Il tipo di progetto **📰 Blog** crea la *featured image* di un articolo (formati 16:9, 3:2, 1.91:1 per le anteprime social, 4:3, 1:1).

1. Allega l'articolo nei **Riferimenti** (txt, md, PDF o DOCX): resta salvato nell'app e lo ritrovi nelle sessioni successive.
2. Spunta l'articolo, scegli **📰 Blog** e scrivi nel brief le tue indicazioni (elementi da includere, stile, colori), oppure lascialo quasi vuoto.
3. *Crea prompt e genera* (o *Proponimi tu 3 idee*).

Il modello che scrive il prompt tratta l'articolo come fonte principale: prima ne scrive una lettura in tre punti, **argomento**, **tono** e **spirito**, che compare nel registro e nel riquadro *Idea proposta*; poi ne ricava l'idea visiva e il prompt. Le indicazioni del brief vengono rispettate, ma dentro il tono e lo spirito dell'articolo, salvo che chiedi espressamente un registro diverso. Per questo tipo l'articolo viene letto per intero fino a circa 30.000 caratteri (circa 5.000 parole), qualunque sia la scelta in *Testo da usare per ogni file*. Se non c'è nessun articolo spuntato il registro lo segnala e il prompt si basa solo sul brief.

La mascherina propone il preset *Immagine articolo* (titolo e categoria in basso a sinistra).

## Vettorializzazione (SVG)

Il pulsante **⇪ SVG** traccia l'immagine in locale, senza inviarla a nessun servizio: riduce i colori (scelti nel menu accanto), traccia i contorni e produce un SVG a colori piatti. Dà il meglio con loghi e icone; con fotografie e sfumature il risultato è grande e poco fedele.

## Dati e backup

- Di default tutto sta nella cartella del progetto. Con `DATA_DIR` in `.env` (ad esempio `~/.local/share/coverforge`) database, upload e immagini generate si spostano altrove; i dati esistenti vanno copiati a mano prima del cambio.
- `coverforge.db`: cronologia e file di riferimento (SQLite). Alla chiusura normale del server il contenuto del file `-wal` viene riportato nel `.db`; se il server viene interrotto bruscamente copia sempre insieme `coverforge.db`, `coverforge.db-wal` e `coverforge.db-shm`.
- `generated/`: le immagini generate. `uploads/`: i file di riferimento caricati.
- La cronologia conserva le ultime 500 immagini.

## Verifica del codice

```bash
npm run check    # controllo di sintassi di tutti i file JavaScript
```


## Sicurezza e dipendenze

- I file caricati sono controllati sul contenuto (non solo sull'estensione); i non-immagini si scaricano invece di aprirsi nel browser.
- `npm audit` segnala 3 avvisi moderati (`sprintf-js` → `argparse` → `mammoth`). L'app non è esposta: `argparse` è usato soltanto dal comando `mammoth` da terminale, che CoverForge non usa. Non lanciare `npm audit fix --force`, che installerebbe una versione di `mammoth` molto più vecchia.
- I 12 font usati (interfaccia e mascherina) sono inclusi in `public/fonts/` (licenza SIL OFL 1.1, vedi `public/fonts/LEGGIMI.txt`): l'app non contatta Google e funziona offline.
