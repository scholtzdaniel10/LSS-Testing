import { NavLink } from 'react-router-dom';
import { useProject } from '../state/ProjectContext';

const links = [
  { to: '/health', label: 'Health' },
  { to: '/explore', label: 'Explore' },
  { to: '/diagnose', label: 'Diagnose' },
  { to: '/test', label: 'Test' },
  { to: '/settings', label: 'Settings' },
];

const TopNav: React.FC = () => {
  const { project, status } = useProject();
  return (
    <nav className="topnav">
      <span className="topnav__brand">
        maintain<span className="topnav__brand-dot" aria-hidden="true" />
      </span>
      <span className="topnav__program" title="Imported program">
        {project?.name ?? (status === 'loading' ? '…' : 'no project')}
      </span>
      <div className="topnav__links">
        {links.map((l) => (
          <NavLink key={l.to} to={l.to} className="topnav__link" activeClassName="topnav__link--active">
            {l.label}
          </NavLink>
        ))}
      </div>
      <span className="topnav__spacer" />
      <span className="topnav__tag">live API</span>
    </nav>
  );
};

export default TopNav;
