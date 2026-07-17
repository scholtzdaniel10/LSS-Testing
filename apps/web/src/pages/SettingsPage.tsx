import { useEntrance } from '../lib/anim';
import { targetEnv } from '../mock/data';

const SettingsPage: React.FC = () => {
  const ref = useEntrance();

  return (
    <div className="page">
      <div className="page__inner" ref={ref} style={{ maxWidth: 760 }}>
        <div data-animate>
          <h1 className="page__title">Settings</h1>
          <p className="page__subtitle">Target environment and your editor bridge.</p>
        </div>

        <div className="panel" data-animate>
          <div className="panel__head">
            <h2 className="panel__title">Target environment</h2>
            <span className="panel__hint">where your program runs — we never execute imported code</span>
          </div>
          <div className="field">
            <label htmlFor="env-name">Name</label>
            <input id="env-name" defaultValue={targetEnv.name} />
          </div>
          <div className="field">
            <label htmlFor="env-url">Base URL</label>
            <input id="env-url" defaultValue={targetEnv.baseUrl} />
            <span className="field__hint">{targetEnv.notes} · credentials are never stored (invariant 5)</span>
          </div>
        </div>

        <div className="panel" data-animate>
          <div className="panel__head">
            <h2 className="panel__title">Open in my IDE</h2>
            <span className="panel__hint">files open in your editor, Godot-style</span>
          </div>
          <div className="field">
            <label htmlFor="ide-preset">Editor</label>
            <select id="ide-preset" defaultValue="vscode">
              <option value="vscode">VS Code</option>
              <option value="phpstorm">PhpStorm</option>
              <option value="sublime">Sublime Text</option>
              <option value="custom">Custom command…</option>
            </select>
            <span className="field__hint">
              VS Code preset launches <span className="mono">vscode://file/&#123;path&#125;:&#123;line&#125;</span>
            </span>
          </div>
          <button type="button" className="btn">
            Test launch
          </button>
        </div>

        <p className="v0-banner" data-animate>
          v0 preview — forms are non-persisting; target-env CRUD is TST-1, the IDE bridge is IG-15.
        </p>
      </div>
    </div>
  );
};

export default SettingsPage;
