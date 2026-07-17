import { Redirect, Route, Switch } from 'react-router-dom';
import { IonApp, setupIonicReact } from '@ionic/react';
import { IonReactRouter } from '@ionic/react-router';

import TopNav from './components/TopNav';
import HealthPage from './pages/HealthPage';
import ExplorePage from './pages/ExplorePage';
import DiagnosePage from './pages/DiagnosePage';
import TestPage from './pages/TestPage';
import SettingsPage from './pages/SettingsPage';

/* Core CSS required for Ionic components to work properly */
import '@ionic/react/css/core.css';
import '@ionic/react/css/normalize.css';
import '@ionic/react/css/structure.css';
import '@ionic/react/css/typography.css';

/* Single dark identity (anime.js look) — light mode is out of scope for v0 */
import '@ionic/react/css/palettes/dark.always.css';

import './theme/variables.css';
import './theme/tokens.css';
import './theme/app.css';

setupIonicReact();

const App: React.FC = () => (
  <IonApp>
    <IonReactRouter>
      <div className="app-shell">
        <TopNav />
        <Switch>
          <Route exact path="/health" component={HealthPage} />
          <Route exact path="/explore" component={ExplorePage} />
          <Route exact path="/diagnose" component={DiagnosePage} />
          <Route exact path="/test" component={TestPage} />
          <Route exact path="/settings" component={SettingsPage} />
          <Route exact path="/">
            <Redirect to="/health" />
          </Route>
        </Switch>
      </div>
    </IonReactRouter>
  </IonApp>
);

export default App;
