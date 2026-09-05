import { useEffect, useState } from 'react';
import { useAuth } from './auth/AuthContext';
import Login from './auth/Login';
import Signup from './auth/Signup';
import BoardList from './BoardList';
import BoardDetail from './BoardDetail';
import TeamMembers from './TeamMembers';
import Sidebar from './Sidebar';
import { api } from './api';
import './App.css';

const TEAM_STORAGE_KEY = 'kanban_current_team';

function AuthGate() {
  const [showSignup, setShowSignup] = useState(false);
  return showSignup
    ? <Signup onSwitchToLogin={() => setShowSignup(false)} />
    : <Login onSwitchToSignup={() => setShowSignup(true)} />;
}

function AuthenticatedApp() {
  const [teams, setTeams] = useState(null);
  const [currentTeamId, setCurrentTeamId] = useState(() => localStorage.getItem(TEAM_STORAGE_KEY));
  const [selectedBoardId, setSelectedBoardId] = useState(null);
  const [view, setView] = useState('boards'); // 'boards' | 'members'
  const [error, setError] = useState('');

  const loadTeams = () => api.getMyTeams().then(setTeams).catch(e => setError(e.message));

  useEffect(() => { loadTeams(); }, []);

  // Once teams load, make sure the "current" team is actually one of theirs
  // (it may have been removed since, or never set for a first-time user).
  useEffect(() => {
    if (!teams) return;
    if (!teams.some(t => t._id === currentTeamId)) {
      setCurrentTeamId(teams[0]?._id ?? null);
    }
  }, [teams]);

  useEffect(() => {
    if (currentTeamId) localStorage.setItem(TEAM_STORAGE_KEY, currentTeamId);
  }, [currentTeamId]);

  const handleSwitchTeam = (teamId) => {
    setCurrentTeamId(teamId);
    setSelectedBoardId(null);
    setView('boards');
  };

  const handleCreateTeam = async (name) => {
    const team = await api.createTeam(name);
    await loadTeams();
    setCurrentTeamId(team._id);
  };

  if (!teams) return <p style={{ padding: 24 }}>{error || 'Loading…'}</p>;

  const currentTeam = teams.find(t => t._id === currentTeamId);

  return (
    <div className="app-shell">
      <Sidebar
        teams={teams}
        currentTeamId={currentTeamId}
        onSwitchTeam={handleSwitchTeam}
        onCreateTeam={handleCreateTeam}
        view={view}
        onChangeView={(v) => { setView(v); setSelectedBoardId(null); }}
      />
      <main className="main-content">
        {!currentTeam ? (
          <div className="empty-state">
            <h1>No teams yet</h1>
            <p>Create a team from the sidebar to start adding boards.</p>
          </div>
        ) : view === 'members' ? (
          <TeamMembers team={currentTeam} />
        ) : selectedBoardId ? (
          <BoardDetail boardId={selectedBoardId} onBack={() => setSelectedBoardId(null)} />
        ) : (
          <BoardList teamId={currentTeam._id} onOpenBoard={setSelectedBoardId} />
        )}
      </main>
    </div>
  );
}

function App() {
  const { user, loading } = useAuth();

  if (loading) return <p style={{ padding: 24 }}>Loading…</p>;
  if (!user) return <AuthGate />;
  return <AuthenticatedApp />;
}

export default App;
