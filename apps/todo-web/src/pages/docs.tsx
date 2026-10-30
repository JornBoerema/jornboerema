import { useEffect } from "react";
import { Link } from "react-router";
import { API_URL } from "@/lib/api";
import { Brand } from "@/components/brand";
import { ArrowLeft, ExternalLink } from "@/components/icons";
import { Button } from "@evido/ui/components/button";
import { McpCopyButton } from "@/components/mcp-copy-button";
import { useI18n } from "@/i18n";

const mcpUrl = `${API_URL}/mcp`;

export function DocsPage() {
  const { t } = useI18n();
  const s = t.docs;
  const steps = [s.chatgpt.steps.developerMode, s.chatgpt.steps.add, s.chatgpt.steps.grant, s.chatgpt.steps.start];
  const tools = Object.entries(s.tools.list);
  useEffect(() => { document.title = `${s.pageTitle} · Even doen`; }, [s.pageTitle]);
  return <div className="mcp-docs">
    <header className="account-header">
      <Link to="/" aria-label={s.brandLabel}><Brand /></Link>
      <Button asChild variant="ghost"><Link to="/">{s.toApp}</Link></Button>
    </header>
    <main className="mcp-docs-content">
      <Link to="/" className="account-back"><ArrowLeft className="size-4" aria-hidden="true" />{s.back}</Link>
      <div className="mcp-docs-heading">
        <h1>{s.title}</h1>
        <p>{s.intro}</p>
      </div>
      <section aria-labelledby="connection-title" className="mcp-connection">
        <h2 id="connection-title">{s.connection.title}</h2>
        <code className="mcp-endpoint">{mcpUrl}</code>
        <div className="mcp-connection-actions">
          <McpCopyButton url={mcpUrl} />
          <Button asChild><a href="https://chatgpt.com/plugins" target="_blank" rel="noopener noreferrer">{s.connection.openChatGpt}<ExternalLink data-icon="inline-end" aria-hidden="true" /></a></Button>
        </div>
        <p>{s.connection.help}</p>
      </section>
      <nav aria-label={s.nav.label} className="mcp-docs-nav">
        <a href="#chatgpt">{s.nav.connect}</a><a href="#examples">{s.nav.examples}</a><a href="#tools">{s.nav.tools}</a><a href="#help">{s.nav.help}</a>
      </nav>
      <section id="chatgpt" className="mcp-docs-section" aria-labelledby="chatgpt-title">
        <h2 id="chatgpt-title">{s.chatgpt.title}</h2>
        <ol className="mcp-steps">
          {steps.map((step) => <li key={step.title}><strong>{step.title}</strong><p>{step.body}</p></li>)}
        </ol>
        <a className="mcp-docs-link" href="https://developers.openai.com/plugins/deploy/connect-chatgpt" target="_blank" rel="noopener noreferrer">{s.chatgpt.official}</a>
      </section>
      <section id="examples" className="mcp-docs-section" aria-labelledby="examples-title">
        <h2 id="examples-title">{s.examples.title}</h2>
        <dl className="mcp-examples">
          <div><dt>{s.examples.tasks}</dt><dd>{s.examples.tasksExample}</dd></div>
          <div><dt>{s.examples.notes}</dt><dd>{s.examples.notesExample}</dd></div>
        </dl>
        <p>{s.examples.after}</p>
      </section>
      <section id="tools" className="mcp-docs-section" aria-labelledby="tools-title">
        <h2 id="tools-title">{s.tools.title}</h2>
        <p>{s.tools.intro}</p>
        <details className="mcp-tools">
          <summary>{s.tools.show(tools.length)}</summary>
          <dl>{tools.map(([name, description]) => <div key={name}><dt><code>{name}</code></dt><dd>{description}</dd></div>)}</dl>
        </details>
        <p>{s.tools.notes}</p>
      </section>
      <section id="help" className="mcp-docs-section" aria-labelledby="help-title">
        <h2 id="help-title">{s.help.title}</h2>
        <h3>{s.help.missingTitle}</h3>
        <p>{s.help.missing}</p>
        <h3>{s.help.readOnlyTitle}</h3>
        <p>{s.help.readOnly}</p>
        <h3>{s.help.otherTitle}</h3>
        <p>{s.help.other}</p>
        <h3>{s.help.errorTitle}</h3>
        <p>{s.help.error}</p>
      </section>
      <footer className="mcp-docs-footer"><Link to="/">{s.footer}</Link></footer>
    </main>
  </div>;
}
