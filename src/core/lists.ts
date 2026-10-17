// Word lists for the heuristic name/address detection. Lowercase for lookup.

export const FIRST_NAMES = new Set(`
alexander andreas anna anne annika anja antje benjamin bernd birgit bettina brigitte carina carsten charlotte
christa christian christiane christina christine christoph claudia corinna cornelia daniel daniela david denise
dennis dieter dirk doris dominik elena elias elisabeth elke emil emilia emily emma erik erika eva fabian felix
finn florian frank franziska frieda friedrich gabriele georg gerhard gisela greta gudrun günter günther hanna
hannah hans harald heike heinz helga helmut hendrik henry herbert hildegard holger horst ida ilse ines ingrid
irene iris jakob jan jana janina jannik jens jessica joachim jochen johanna johannes jonas jonathan josef julia
julian juliane jürgen jutta kai karin karl karla katharina kathrin katja kerstin kevin kim klaus konrad kristina
lara larissa laura lea lena leon leonie lina linus lisa louis luca lucas luis luisa lukas maik manfred manuel
manuela marc marcel marco margarete maria marie marina mario marion markus marlene martin martina marvin mathias
matthias max maximilian melanie mia michael michaela michelle milan mila mohammed monika moritz nadine natalie
nicole niklas nils nina noah nora norbert olaf oliver oskar patrick paul paula peter petra philipp rainer ralf
regina renate rene robert robin roland rolf rosemarie ruth sabine sabrina sandra sara sarah sascha sebastian
silke simon simone sofia sonja sophia sophie stefan stefanie steffen stephan susanne sven svenja tanja thomas
tim timo tobias tom torsten ulrich ulrike ursula ute uwe valentina vanessa vera verena viktoria walter werner
wolfgang yvonne
`.trim().split(/\s+/));

// Only surnames that are not also common German nouns/adjectives ("Koch", "Richter", "Lange" ...).
export const LAST_NAMES = new Set(`
müller schmidt schneider fischer weber meyer wagner becker schulz hoffmann schäfer schröder neumann zimmermann
krüger hofmann hartmann schmitt schmitz krause lehmann schmid schulze maier köhler herrmann mayer huber scholz
möller schubert berger winkler roth lorenz baumann franke albrecht böhm schumacher krämer vogt seidel brandt
schulte dietrich ziegler kuhn kühn pohl bergmann voigt wolff pfeiffer yilmaz kaya demir şahin çelik öztürk
nowak kowalski mustermann musterfrau
`.trim().split(/\s+/));

// Words after which the next capitalised words are a name.
export const NAME_SALUTATIONS = new Set(['herr', 'herrn', 'frau', 'hr', 'fr', 'liebe', 'lieber', 'hallo', 'hi', 'geb', 'geborene', 'geborener']);
export const NAME_LABELS = new Set(`
name namen vorname vornamen nachname familienname geburtsname patient patientin kunde kundin mandant mandantin
versicherte versicherter versicherungsnehmer inhaber inhaberin ansprechpartner ansprechpartnerin sachbearbeiter
sachbearbeiterin absender empfänger unterschrift gez schüler schülerin kind mutter vater antragsteller
antragstellerin arbeitnehmer arbeitnehmerin mieter mieterin vermieter vermieterin erziehungsberechtigte
erziehungsberechtigter kontoinhaber kontoinhaberin auftraggeber bearbeiter
`.trim().split(/\s+/));
// Capitalised words that often follow a name or a label in documents but are never names.
export const NOT_NAMES = new Set(`
e-mail email mail tel telefon telefax fax mobil handy web www internet iban bic konto kontonummer bank nr nummer
datum betreff seite anlage anlagen adresse anschrift straße strasse postfach ort plz geburtsdatum geburtsort
herren damen sehr geehrte geehrter mit freundlichen grüßen grüße ihre ihr ihren sie wir ich und oder der die das
den dem des ein eine bitte danke vielen dank vom von bis am im zum zur für per gmbh ag kg ug ev e.v mbh co
unterschrift vertreten vertreter geschäftsführer geschäftsführerin vorstand amtsgericht steuernummer ust-idnr
deutschland österreich schweiz berlin hamburg münchen köln frankfurt stuttgart düsseldorf leipzig dortmund essen
bremen dresden hannover nürnberg duisburg bochum wuppertal bielefeld bonn münster mannheim karlsruhe augsburg
wiesbaden kiel aachen kassel mainz freiburg erfurt rostock wien zürich
`.trim().split(/\s+/));

// Academic titles: skipped (not redacted) between a trigger and the name.
export const TITLES = new Set(['dr', 'prof', 'med', 'dipl', 'ing', 'rer', 'nat', 'phil', 'jur', 'mag', 'ba', 'ma', 'msc', 'bsc']);
export const NAME_PARTICLES = new Set(['von', 'van', 'de', 'der', 'zu', 'vom', 'den', 'di', 'da', 'el', 'al']);

// Strong street suffixes count on their own; weak ones need a house number next.
export const STREET_STRONG = /(straße|strasse|str\.?|allee|gasse|chaussee|promenade)$/i;
export const STREET_WEAK = /(weg|platz|ring|damm|ufer|steig|pfad|stieg|graben|wall|markt|hof|berg|feld|garten|brücke|bogen|kamp|tor)$/i;
export const STREET_GENERIC = new Set(['straße', 'strasse', 'str', 'weg', 'allee', 'platz', 'ring', 'gasse', 'damm', 'ufer', 'chaussee']);
export const STREET_PREPOSITIONS = new Set(['am', 'an', 'auf', 'im', 'in', 'zum', 'zur', 'unter', 'hinter', 'vor', 'beim', 'alte', 'alter', 'neue', 'neuer', 'große', 'kleine', 'obere', 'untere']);
export const CITY_PARTICLES = new Set(['am', 'an', 'der', 'die', 'im', 'ob', 'a', 'd', 'bei', 'in', 'vor', 'dem', 'den']);

// Dummy values.
export const FAKE_FIRST = ['Lena', 'Jonas', 'Mia', 'Felix', 'Hanna', 'Paul', 'Clara', 'Leon', 'Ida', 'Elias', 'Greta', 'Anton', 'Frieda', 'Theo', 'Nora', 'Oskar'];
export const FAKE_LAST = ['Berger', 'Winkler', 'Lorenz', 'Brandt', 'Kessler', 'Vogel', 'Seidel', 'Kraus', 'Hahn', 'Franke', 'Engel', 'Busch', 'Roth', 'Graf', 'Pohl', 'Ziegler'];
export const FAKE_STREET = ['Lindenweg', 'Ahornstraße', 'Birkenallee', 'Kastanienweg', 'Eichenring', 'Ulmenstraße', 'Buchenplatz', 'Erlengasse', 'Fliederweg', 'Rosenstraße'];
export const FAKE_STREET_PART = ['Linden', 'Ahorn', 'Birken', 'Kastanien', 'Eichen', 'Ulmen', 'Buchen', 'Erlen', 'Flieder', 'Rosen'];
export const FAKE_CITY = ['Musterstadt', 'Beispielhausen', 'Lindental', 'Ahorndorf', 'Wiesenau', 'Bachingen', 'Tannenfeld', 'Sonnenberg'];
