import { useEffect } from "react";
import { Link } from "react-router";
import { API_URL } from "@/lib/api";
import { Brand } from "@/components/brand";
import { ArrowLeft, ExternalLink } from "@/components/icons";
import { Button } from "@evido/ui/components/button";
import { McpCopyButton } from "@/components/mcp-copy-button";


const mcpUrl = `${API_URL}/mcp`;
const tools = [
  ["read_workspace", "Lees al je workspaces met hun lijsten, taken en notities."],
  ["create_list", "Maak een takenlijst of (met kind: note) notitie aan, optioneel in een gekozen workspace."],
  ["rename_list", "Hernoem een lijst of notitie in een van je workspaces."],
  ["delete_list", "Verwijder een lijst of notitie met alle inhoud."],
  ["create_todo", "Voeg een taak toe aan een lijst."],
  ["update_todo", "Bewerk de titel of zet een taak op te doen, mee bezig of klaar."],
  ["delete_todo", "Verwijder een taak."],
  ["move_list", "Zet een lijst of notitie op een andere plek in de zijbalk."],
  ["move_todo", "Plaats een item voor of na een ander item in dezelfde lijst en status."],
  ["create_note", "Maak een notitie aan met een naam en optionele Markdown-inhoud."],
  ["update_note", "Bewerk de Markdown-inhoud met de actuele versie van de notitie."],
];

export function DocsPage() {
  useEffect(() => { document.title = "MCP koppelen · Even doen"; }, []);
  return <div className="mcp-docs">
    <header className="account-header">
      <Link to="/" aria-label="Even doen — naar je lijsten"><Brand /></Link>
      <Button asChild variant="ghost"><Link to="/">Naar de app</Link></Button>
    </header>
    <main className="mcp-docs-content">
      <Link to="/" className="account-back"><ArrowLeft className="size-4" aria-hidden="true" />Terug naar je lijsten</Link>
      <div className="mcp-docs-heading">
        <h1>Even doen koppelen aan je AI-assistent</h1>
        <p>Laat je assistent taken en notities voor je bijhouden. Via MCP werkt die rechtstreeks in je Even doen-lijsten.</p>
      </div>
      <section aria-labelledby="connection-title" className="mcp-connection">
        <h2 id="connection-title">Dit is je MCP-URL</h2>
        <code className="mcp-endpoint">{mcpUrl}</code>
        <div className="mcp-connection-actions">
          <McpCopyButton url={mcpUrl} />
          <Button asChild><a href="https://chatgpt.com/plugins" target="_blank" rel="noopener noreferrer">Open ChatGPT Plugins<ExternalLink data-icon="inline-end" aria-hidden="true" /></a></Button>
        </div>
        <p>De knop opent ChatGPT. Voeg daar de URL toe en log in met je Even doen-account.</p>
      </section>
      <nav aria-label="Op deze pagina" className="mcp-docs-nav">
        <a href="#chatgpt">Koppelen</a><a href="#examples">Voorbeelden</a><a href="#tools">Alle acties</a><a href="#help">Hulp</a>
      </nav>
      <section id="chatgpt" className="mcp-docs-section" aria-labelledby="chatgpt-title">
        <h2 id="chatgpt-title">Koppelen aan ChatGPT</h2>
        <ol className="mcp-steps">
          <li><strong>Zet Developer mode aan.</strong><p>Open Settings → Security and login → Developer mode. Beschikbaarheid hangt af van je account en workspace.</p></li>
          <li><strong>Voeg de verbinding toe.</strong><p>Open ChatGPT Plugins en klik op +. Gebruik de naam “Even doen”, plak de MCP-URL en kies OAuth als authenticatie.</p></li>
          <li><strong>Geef toegang.</strong><p>Log in met je Even doen-account en bevestig de gevraagde toegang. Je hebt geen API-sleutel nodig.</p></li>
          <li><strong>Begin een gesprek.</strong><p>Selecteer de koppeling in het tools-menu van een nieuw gesprek en vertel wat je wilt doen.</p></li>
        </ol>
        <a className="mcp-docs-link" href="https://developers.openai.com/plugins/deploy/connect-chatgpt" target="_blank" rel="noopener noreferrer">Officiële OpenAI-aansluitinstructies ↗</a>
      </section>
      <section id="examples" className="mcp-docs-section" aria-labelledby="examples-title">
        <h2 id="examples-title">Probeer het eens</h2>
        <dl className="mcp-examples">
          <div><dt>Taken</dt><dd>“Maak een lijst Werk en voeg ‘Offerte versturen’ toe.”</dd></div>
          <div><dt>Notities</dt><dd>“Maak een notitie Vakantieplannen met een checklist voor de reis.”</dd></div>
        </dl>
        <p>Je kunt daarna bijvoorbeeld een taak afvinken, op mee bezig zetten of een notitie aanvullen. Wijzigingen worden in dezelfde app opgeslagen.</p>
      </section>
      <section id="tools" className="mcp-docs-section" aria-labelledby="tools-title">
        <h2 id="tools-title">Wat kan de koppeling?</h2>
        <p>Lezen, aanmaken, bewerken, ordenen en verwijderen. De assistent ziet alle workspaces waar jij lid van bent en kan daarin hetzelfde als jij.</p>
        <details className="mcp-tools">
          <summary>Bekijk alle {tools.length} MCP-acties</summary>
          <dl>{tools.map(([name, description]) => <div key={name}><dt><code>{name}</code></dt><dd>{description}</dd></div>)}</dl>
        </details>
        <p>Een notitie bewaart opmaak via Markdown en gebruikt versies om gelijktijdige wijzigingen niet stil te overschrijven.</p>
      </section>
      <section id="help" className="mcp-docs-section" aria-labelledby="help-title">
        <h2 id="help-title">Hulp bij het koppelen</h2>
        <h3>Ontbreken de nieuwe acties?</h3>
        <p>Open de verbinding bij ChatGPT Plugins en kies Refresh. Begin daarna een nieuw gesprek.</p>
        <h3>Kan je assistent alleen lezen?</h3>
        <p>Koppel opnieuw met schrijftoegang. Ook bij gedeelde lijsten heb je bewerkrechten nodig om inhoud te wijzigen.</p>
        <h3>Gebruik je een andere MCP-app?</h3>
        <p>Voeg dezelfde URL toe als externe MCP-server. De app moet Streamable HTTP en OAuth ondersteunen. Meld je aan met je Even doen-account.</p>
        <h3>Zie je een fout als je de MCP-URL in je browser opent?</h3>
        <p>Dat is geen gewone webpagina. Plak de URL in de MCP-instellingen van je assistent; gebruik deze pagina voor de uitleg.</p>
      </section>
      <footer className="mcp-docs-footer"><Link to="/">Terug naar Even doen</Link></footer>
    </main>
  </div>;
}
