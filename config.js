'use strict';

// FRV:s EmailJS-inställningar för styrelseformuläret – ett EGET konto för
// Funktionsrätt Västmanland, INTE VSI-admins (helt annan organisation, se
// vsi-forms/config.js där för jämförelse). Så länge värdena nedan är tomma
// är EmailJS avstängt och formuläret faller tillbaka på mailto:/kopiera text.
//
// Skapa kontot på https://www.emailjs.com/ (gratis), koppla en avsändare
// (t.ex. kansli@funktionsrattvastmanland.se via Outlook365-tjänsten eller
// SMTP), skapa en mall och fyll i de tre värdena nedan. Publika nyckeln är
// inte hemlig – EmailJS är designat för att den ska ligga i klientkod.
window.FRV_EMAILJS_SERVICE_ID = '';
window.FRV_EMAILJS_TEMPLATE_ID = '';
window.FRV_EMAILJS_PUBLIC_KEY = '';
