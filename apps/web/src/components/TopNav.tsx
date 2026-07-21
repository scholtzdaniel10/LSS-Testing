import { NavLink } from 'react-router-dom';
import { useProject } from '../state/ProjectContext';

const links = [
  { to: '/health', label: 'Health' },
  { to: '/projects', label: 'Projects' },
  { to: '/explore', label: 'Explore' },
  { to: '/diagnose', label: 'Diagnose' },
  { to: '/test', label: 'Test' },
  { to: '/settings', label: 'Settings' },
];

const TopNav: React.FC = () => {
  const { project, projects, selectProject, status } = useProject();

  return (
    <nav className="topnav">
      <span className="topnav__brand">
        maintain<span className="topnav__brand-dot" aria-hidden="true" />
      </span>
      <label className="topnav__program">
        <span className="visually-hidden">Active project</span>
        <select
          className="topnav__program-select"
          value={project?.id ?? ''}
          onChange={(e) => {
            if (e.target.value) selectProject(e.target.value);
          }}
          disabled={status === 'loading' || projects.length === 0}
          title="Switch imported program"
        >
          <option value="" disabled>
            {status === 'loading' ? 'Loading…' : projects.length === 0 ? 'No projects' : 'Select project…'}
          </option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
              {p.lastImportedAt ? '' : ' (not imported)'}
            </option>
          ))}
        </select>
      </label>
      <div className="topnav__links">
        {links.map((l) => (
          <NavLink key={l.to} to={l.to} className="topnav__link" activeClassName="topnav__link--active">
            {l.label}
          </NavLink>
        ))}
      </div>
      <span className="topnav__spacer" />
      <span className="topnav__tag">live API</span>
    <