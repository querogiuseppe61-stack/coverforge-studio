# Guida per scrivere i prompt di CoverForge Studio

Questo file viene letto dal server a ogni richiesta (non serve riavviare dopo una modifica).
Ogni sezione `## nome` è usata solo quando serve: `generale` sempre; la sezione del tipo di progetto
(`libro`, `album`, `logo`, `icona`, `header`, `blog`); `testo` oppure `senza-testo`; `riferimenti` solo se ci sono immagini allegate.
`modifica` si usa solo per «Rifinisci», quando l'LLM prepara l'istruzione di modifica.
Le istruzioni sono per il modello che scrive il prompt; il prompt finale deve essere in inglese.
Versione 3: più libertà creativa e regola specifica per la saggistica. Le versioni precedenti sono in `cover-forge.v1-minimale.bak` (molto prescrittiva) e `cover-forge.v2.bak` (senza la regola sulla saggistica).

## generale

Il generatore di immagini è un modello conversazionale, non uno strumento a parametri: capisce frasi descrittive in inglese naturale.
Scrivi UN solo prompt, 60-140 parole, come una descrizione continua di ciò che si vede.

Punta a un'immagine ricca, specifica e memorabile, non generica né spoglia. Sii concreto e sensoriale: oggetti precisi, materiali, texture, gesti, dettagli che raccontano qualcosa del contenuto. Costruisci profondità (primo piano, piano medio, sfondo) e una luce con un carattere preciso.
Rispetta il tono e l'estetica che chiedono il brief e lo stile scelto: se evocano una scena elaborata, pittorica, cupa, barocca o surreale, non semplificarla.

Ordine consigliato: soggetto principale e scena; composizione e punto focale; stile e tecnica (es. "oil painting with heavy impasto", "35mm film photograph", "ink and watercolor"); luce e atmosfera; palette di colori nominati; dettagli di materia e texture.
Un concetto centrale chiaro, con elementi di contorno coerenti che lo rinforzano.

Non scrivere:
- parametri o sintassi tipici di altri strumenti (opzioni con doppio trattino, pesi tra parentesi, "negative prompt", seed, CFG): il formato e le proporzioni sono già impostati dall'app;
- elenchi di cose da escludere ("no X, no Y, not Z"): descrivi invece ciò che c'è;
- frasi rivolte all'utente ("attach the reference image to…", "here is your prompt", "note:"), nomi di software o di modelli;
- virgolette, elenchi puntati, titoli, markdown: solo la descrizione;
- idee in conflitto tra loro nella stessa immagine.

## libro

Copertina di libro. Deve avere un soggetto con una silhouette riconoscibile, così da leggersi anche in miniatura, ma l'immagine può e deve essere ricca di dettagli, texture e profondità: l'obiettivo è una copertina che si distingue, non un'immagine spoglia.
Evoca il genere con simboli, materiali, luce e palette (thriller e horror: ombre dure e un elemento inquietante; romance: toni caldi e intimità; fantasy: luce drammatica e scala; saggistica: metafora visiva forte e composizione ordinata). Per un'antologia, un simbolo centrale più elementi che raccontano il tono dei racconti.
Saggistica, divulgazione, manuali, libri tecnici e di business: non illustrare il tema alla lettera e non fotografare il soggetto. Le prime immagini che vengono in mente per un tema (per il clima il pianeta in fiamme, per il management la stretta di mano o la scalata, per la tecnologia circuiti, cervelli luminosi o codice che scorre) sono quelle che vengono in mente a chiunque e rendono la copertina una tra mille: scartale. Cerca una metafora visiva inattesa e concreta, oppure un trattamento grafico forte: illustrazione concettuale, collage, forme geometriche con colori piani, un solo oggetto trattato in modo insolito, un gesto o un contrasto che dica l'idea del libro. Un'idea sola, netta, con linguaggio da design editoriale (illustrazione, collage, vettoriale, fotografia concettuale in posa) invece che da foto di cronaca o rendering tecnico.
Il titolo verrà aggiunto sopra in un secondo momento: tieni una parte dell'immagine (di solito in alto o in basso) più calma e a basso contrasto, fatta di nebbia, ombra, cielo, texture sfumata, non vuota né bianca, così il testo resta leggibile. Il resto della composizione è libero.
Evita solo dettagli essenziali a ridosso dei bordi, che il taglio di stampa potrebbe perdere.

## album

Copertina di disco, formato quadrato: un'immagine forte e originale, che regga anche a 100 pixel grazie a una silhouette o a un contrasto chiaro, ma con carattere e ricchezza di materia.
Se serviranno nome dell'artista e titolo, tieni una zona più calma e a basso contrasto, non vuota.

## logo

Logo: stile vettoriale piatto, forme geometriche semplici, linee pulite, colori pieni (massimo 3-4), nessuna sfumatura fotografica né ombra realistica.
Sfondo uniforme e semplice. Il simbolo deve restare riconoscibile se rimpicciolito e in bianco e nero. Composizione centrata con margine ampio attorno. Qui la semplicità è lo scopo.

## icona

Icona di app: un solo simbolo grande e centrato, riconoscibile al primo sguardo, margine uniforme attorno, colori pieni e contrasto alto, sfondo uniforme.
Niente testo, niente dettagli sottili che scompaiono a 64 pixel. Qui la semplicità è lo scopo.

## header

Banner largo per un sito. Il soggetto e la scena occupano un lato o una fascia; sull'altro lato la composizione si calma (nebbia, sfumature, spazio con poco dettaglio) per accogliere il titolo sovrapposto, senza diventare un vuoto piatto.
Composizione orizzontale, con linee o orizzonti che guidano lo sguardo. Lo sfondo non deve competere con il testo.

## blog

Immagine principale (featured image) di un articolo di blog: sta in cima al post e diventa l'anteprima quando l'articolo viene condiviso. Deve far capire a colpo d'occhio di che cosa parla l'articolo e con quale voce: argomento, tono e spirito dell'articolo contano più di ogni altra cosa, e decidono luce, palette, stile e atmosfera.
Non illustrare il titolo alla lettera e scarta le immagini da archivio fotografico (persone sorridenti al computer, strette di mano, lampadine, frecce che salgono, mani su una tastiera): sono quelle che rendono ogni blog uguale agli altri. Cerca una scena, un oggetto o un gesto concreto e specifico del mondo dell'articolo, oppure una metafora visiva inattesa che ne dica l'idea centrale.
Un solo punto focale forte e vicino al centro, perché i social e i temi dei blog ritagliano l'immagine in formati diversi (orizzontale, quadrato): niente di essenziale a ridosso dei bordi. Se servirà un titolo sovrapposto, una fascia (di solito in basso o su un lato) resta più calma e a basso contrasto, senza diventare un vuoto piatto.
Deve reggere anche in miniatura: contrasto chiaro tra soggetto e sfondo, pochi elementi ben leggibili.

## testo

Il testo richiesto va scritto ESATTAMENTE come indicato, tra virgolette, una sola volta, con una posizione chiara ("the title … centered in the top third") e un carattere descritto in poche parole ("bold condensed serif letters").
Non aggiungere altre scritte, loghi, filigrane o testo inventato.

## senza-testo

L'immagine non deve contenere lettere, numeri, loghi né filigrane. Non lasciare riquadri vuoti dove andrebbe il testo: le zone calme sono parte della scena (nebbia, ombra, cielo, texture), non rettangoli bianchi.

## riferimenti

All'immagine verranno allegate automaticamente una o più immagini di riferimento: nel prompt scrivi una frase che chieda al generatore di usarle come guida per ciò che serve (stile, palette, composizione, atmosfera) senza copiarle alla lettera, ad esempio
"Use the attached reference image(s) as guidance for the color palette and mood, but create an original composition."
Non descrivere né chiedere all'utente di allegare nulla: l'allegato è già fatto.

## modifica

Il generatore non ritocca: rigenera tutta l'immagine seguendo l'originale. Tutto ciò che l'istruzione non protegge può cambiare, quindi conta quanto dici cosa resta.
Nomina gli elementi da conservare con i tratti visibili che li identificano ("the woman in the red coat on the left", "the lighthouse on the cliff"), così il generatore li riconosce e li mantiene.
Luce: descrivi direzione, colore, durezza e ombre di arrivo, non solo "più scura". Palette: nomina i colori di arrivo e dove vanno. Stile: cambia tecnica e trattamento, ma tieni soggetti, pose e composizione.
Togliere un elemento: descrivi che cosa appare al suo posto (il cielo continua, il muro prosegue, la superficie del tavolo è libera), non solo "remove X".
Testo nell'immagine: se c'è e la richiesta non lo riguarda, chiedi di conservarlo identico, lettera per lettera; se va tolto, chiedi di ricostruire lo sfondo al suo posto.
Una modifica alla volta: più cambiamenti nella stessa istruzione fanno deragliare il risultato.
