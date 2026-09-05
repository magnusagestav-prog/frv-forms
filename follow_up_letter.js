'use strict';

// Standardtexten för följebrevet till styrelseformuläret – EN källa som delas
// av både admin-GUI:t (mail_list_ui.js, redigerbar text under Länkar) och
// själva formuläret (styrelseformular.js, visas alltid – oavsett om länken
// bär med sig en redigerad version i brev-parametern eller inte). Ändra bara
// här, inte i två separata kopior.
window.FRV_DEFAULT_LINK_MESSAGE = `<p>Hej!</p>
<p>Funktionsrätt Västmanland behöver aktuella kontaktuppgifter till er förenings styrelse och
funktionärer för att kunna nå er med information, kallelser och annat som rör medlemskapet.</p>
<p>Uppgifterna ger också era funktionärer tillgång till förbundets intranät, där ni bland annat
kan boka lokaler och se annan medlemsinformation.</p>
<p>Kort om fälten i formuläret: <strong>Position</strong> är personens faktiska styrelsepost
(ordförande, kassör osv). <strong>Offentlig</strong> kryssas i om personen får visas i
föreningens publika funktionärslista. <strong>Bokningsbehörighet</strong> ger rätt att boka
lokaler via intranätet.</p>
<p>Fyll gärna i länken nedan så snart ni har möjlighet:</p>
<p>Om du inte är rätt person att svara på detta men vet vem som kan göra det, vidarebefordra
gärna detta mejl till den personen.</p>
<p>Vet du inte vem som är rätt person, eller har du inte dennes e-postadress? I formuläret
finns en knapp, "Skicka till nästa person", som automatiskt skickar det vidare i rätt ordning
i styrelsen.</p>`;
