import "./Navbar.css";

type Tab = "options" | "recents" | "settings";

interface Props {
  activeTab: Tab;
  onTabChange: (tab: Tab) => void;
}

export default function Navbar({ activeTab, onTabChange }: Props) {
  // const tabs: Tab[] = ["session", "options", "settings"];
  // const tabs: Tab[] = ["record", "activities", "settings"]; recents  features
  const tabs: Tab[] = ["options", "recents", "settings"];

  return (
    <nav className="navbar">
      <div className="navbarContainer">
        {tabs.map((tab) => (
          <button
            key={tab}
            className={`navItem ${activeTab === tab ? "active" : ""}`}
            onClick={() => onTabChange(tab)}
          >
            {tab}
            {activeTab === tab && (
              <span className="activeIndicator" />
            )}
          </button>
        ))}
      </div>
    </nav>
  );
}
