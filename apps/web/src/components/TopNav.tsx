import { NavLink } from 'react-router-dom';
import { program } from '../mock/data';

const links = [
  { to: '/health', label: 'Health' },
  { to: '/explore', label: 'Explore' },
  { to: '/diagnose', label: 'Diagnose' },
  { to: '/test', label: 'Test' },
  { to: '/settings', label: 'Settings' },
];

const TopNav: React.FC = () => (
  <nav className="topnav">
    <span className="topnav__brand">
      maintain<span className="topnav__brand-dot" aria-hidden="true" />
    </span>
    <span className="topnav__program" title="Imported program">
      {program.name}
    </span>
    <div className="topnav__links">
      {links.map((l) => (
        <NavLink key={l.to} to={l.to} className="topnav__link" activeClassName="topnav__link--active">
          {l.label}
        </NavLink>
      ))}
    </div>
    <span className="topnav__spacer" />
    <span className="topnav__tag">v0 preview · mock data</span>
  </nav>
);

export default TopNav;
