import type { docs as en } from "../en/docs"

// Dutch texts for the "docs" namespace (MCP guide); typed against the English keys.
export const docs: typeof en = {
  pageTitle: "MCP koppelen",
  brandLabel: "Even doen — naar je lijsten",
  toApp: "Naar de app",
  back: "Terug naar je lijsten",
  title: "Even doen koppelen aan je AI-assistent",
  intro: "Laat je assistent taken en notities voor je bijhouden. Via MCP werkt die rechtstreeks in je Even doen-lijsten.",
  connection: {
    title: "Dit is je MCP-URL",
    openChatGpt: "Open ChatGPT Plugins",
    help: "De knop opent ChatGPT. Voeg daar de URL toe en log in met je Even doen-account.",
    copy: "Kopieer MCP-URL",
    copied: "MCP-URL gekopieerd.",
    copyFailed: "Kopiëren lukt niet. Selecteer de URL hierboven en kopieer deze handmatig.",
  },
  nav: {
    label: "Op deze pagina",
    connect: "Koppelen",
    examples: "Voorbeelden",
    tools: "Alle acties",
    help: "Hulp",
  },
  chatgpt: {
    title: "Koppelen aan ChatGPT",
    steps: {
      developerMode: {
        title: "Zet Developer mode aan.",
        body: "Open Settings → Security and login → Developer mode. Beschikbaarheid hangt af van je account en workspace.",
      },
      add: {
        title: "Voeg de verbinding toe.",
        body: "Open ChatGPT Plugins en klik op +. Gebruik de naam “Even doen”, plak de MCP-URL en kies OAuth als authenticatie.",
      },
      grant: {
        title: "Geef toegang.",
        body: "Log in met je Even doen-account en bevestig de gevraagde toegang. Je hebt geen API-sleutel nodig.",
      },
      start: {
        title: "Begin een gesprek.",
        body: "Selecteer de koppeling in het tools-menu van een nieuw gesprek en vertel wat je wilt doen.",
      },
    },
    official: "Officiële OpenAI-aansluitinstructies ↗",
  },
  examples: {
    title: "Probeer het eens",
    tasks: "Taken",
    tasksExample: "“Maak een lijst Werk en voeg ‘Offerte versturen’ toe.”",
    notes: "Notities",
    notesExample: "“Maak een notitie Vakantieplannen met een checklist voor de reis.”",
    after: "Je kunt daarna bijvoorbeeld een taak afvinken, op mee bezig zetten of een notitie aanvullen. Wijzigingen worden in dezelfde app opgeslagen.",
  },
  tools: {
    title: "Wat kan de koppeling?",
    intro: "Lezen, aanmaken, bewerken, ordenen en verwijderen. De assistent ziet alle workspaces waar jij lid van bent en kan daarin hetzelfde als jij.",
    show: (count: number) => `Bekijk alle ${count} MCP-acties`,
    notes: "Een notitie bewaart opmaak via Markdown en gebruikt versies om gelijktijdige wijzigingen niet stil te overschrijven.",
    list: {
      read_workspace: "Lees al je workspaces met hun lijsten, taken en notities.",
      create_list: "Maak een takenlijst of (met kind: note) notitie aan, optioneel in een gekozen workspace.",
      rename_list: "Hernoem een lijst of notitie in een van je workspaces.",
      delete_list: "Verwijder een lijst of notitie met alle inhoud.",
      create_todo: "Voeg een taak toe aan een lijst.",
      update_todo: "Bewerk de titel of zet een taak op te doen, mee bezig of klaar.",
      delete_todo: "Verwijder een taak.",
      move_list: "Zet een lijst of notitie op een andere plek in de zijbalk.",
      move_todo: "Plaats een item voor of na een ander item in dezelfde lijst en status.",
      create_note: "Maak een notitie aan met een naam en optionele Markdown-inhoud.",
      update_note: "Bewerk de Markdown-inhoud met de actuele versie van de notitie.",
    },
  },
  help: {
    title: "Hulp bij het koppelen",
    missingTitle: "Ontbreken de nieuwe acties?",
    missing: "Open de verbinding bij ChatGPT Plugins en kies Refresh. Begin daarna een nieuw gesprek.",
    readOnlyTitle: "Kan je assistent alleen lezen?",
    readOnly: "Koppel opnieuw met schrijftoegang. Ook bij gedeelde lijsten heb je bewerkrechten nodig om inhoud te wijzigen.",
    otherTitle: "Gebruik je een andere MCP-app?",
    other: "Voeg dezelfde URL toe als externe MCP-server. De app moet Streamable HTTP en OAuth ondersteunen. Meld je aan met je Even doen-account.",
    errorTitle: "Zie je een fout als je de MCP-URL in je browser opent?",
    error: "Dat is geen gewone webpagina. Plak de URL in de MCP-instellingen van je assistent; gebruik deze pagina voor de uitleg.",
  },
  footer: "Terug naar Even doen",
}
