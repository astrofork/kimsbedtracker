import React, { useState, useCallback } from "react";
import { Ic, icons, ThemeToggle } from "./ui.jsx";

/**
 * AppShell — shared sidebar + topbar layout for all role apps.
 *
 *   <AppShell
 *     menu={[{ key:"home", icon:icons.home, label:"Home", dot:false }, …]}
 *     active="home"
 *     onSelect={(key) => setTab(key)}
 *     title="Dashboard"            // page title shown in the topbar
 *     user={{ name:"pre1", role:"PRE" }}
 *     onLogout={fn}
 *     topExtra={<node/>}           // optional, rendered left of the user chip
 *     alarm={bool}                 // flashes the content background
 *   >{children}</AppShell>
 *
 * Behavior:
 *  - Desktop/tablet (≥768px): fixed sidebar, toggle collapses to icon rail (70px).
 *  - Mobile (<768px): sidebar becomes a drawer; toggle/scrim open & close it.
 */
export function AppShell({ menu, active, onSelect, title, user, onLogout, topExtra, alarm, children }) {
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem("sb_collapsed") === "1"
  );
  const [drawerOpen, setDrawerOpen] = useState(false);

  // A "sectioned" menu is an array of { section, items:[…] } groups. A flat menu
  // (array of nav items) is still supported for the PRE / Nurse apps.
  const sectioned = Array.isArray(menu) && menu.some((m) => Array.isArray(m?.items));
  const [closedSections, setClosedSections] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem("sb_closed_sections") || "[]")); }
    catch { return new Set(); }
  });
  const toggleSection = (name) =>
    setClosedSections((prev) => {
      const next = new Set(prev);
      next.has(name) ? next.delete(name) : next.add(name);
      localStorage.setItem("sb_closed_sections", JSON.stringify([...next]));
      return next;
    });

  const isMobile = () => window.innerWidth < 768;

  const toggle = useCallback(() => {
    if (isMobile()) {
      setDrawerOpen((o) => !o);
    } else {
      setCollapsed((c) => {
        localStorage.setItem("sb_collapsed", c ? "0" : "1");
        return !c;
      });
    }
  }, []);

  const select = (key) => {
    onSelect(key);
    setDrawerOpen(false);
  };

  const initial = (user?.name || "?").trim().charAt(0) || "?";

  return (
    <div className={"shell" + (collapsed ? " sb-collapsed" : "") + (drawerOpen ? " sb-open" : "")}>
      {/* Sidebar */}
      <aside className="sidebar">
        <div className="sb-brand">
          <div className="logo-sq"><Ic d={icons.bed} s={17} /></div>
          <span className="name">BedFlow</span>
        </div>
        <nav className="sb-menu">
          {sectioned
            ? menu.map((sec) => {
                // When the rail is icon-collapsed we ignore per-section folding
                // and just show every icon — there's no room for headers.
                const closed = !collapsed && closedSections.has(sec.section);
                return (
                  <div key={sec.section} className="sb-section">
                    <button
                      type="button"
                      className={"sb-section-head" + (closed ? " closed" : "")}
                      onClick={() => toggleSection(sec.section)}
                      aria-expanded={!closed}
                    >
                      <span className="lbl">{sec.section}</span>
                      <span className="chev"><Ic d={icons.chevron} s={14} /></span>
                    </button>
                    {!closed && sec.items.map((m) => (
                      <button
                        key={m.key}
                        className={"sb-item" + (active === m.key ? " on" : "")}
                        onClick={() => select(m.key)}
                        title={m.label}
                      >
                        <span className="ic"><Ic d={m.icon} s={18} /></span>
                        <span className="lbl">{m.label}</span>
                        {m.dot && <span className="dot" />}
                      </button>
                    ))}
                  </div>
                );
              })
            : menu.map((m) => (
                <button
                  key={m.key}
                  className={"sb-item" + (active === m.key ? " on" : "")}
                  onClick={() => select(m.key)}
                  title={m.label}
                >
                  <span className="ic"><Ic d={m.icon} s={18} /></span>
                  <span className="lbl">{m.label}</span>
                  {m.dot && <span className="dot" />}
                </button>
              ))}
        </nav>
        <div className="sb-foot">
          <button className="sb-item" onClick={onLogout} title="Logout">
            <span className="ic"><Ic d={icons.logout} s={18} /></span>
            <span className="lbl">Logout</span>
          </button>
        </div>
      </aside>

      {/* Mobile drawer scrim */}
      <div className="sb-scrim" onClick={() => setDrawerOpen(false)} />

      {/* Main column */}
      <div className="shell-main">
        <header className="appbar">
          <button className="appbar-btn" onClick={toggle} aria-label="Toggle navigation">
            <Ic d={icons.menu} s={20} />
          </button>
          <div className="page-title">{title}</div>
          <div className="spacer" />
          {topExtra}
          <ThemeToggle />
          <div className="user-chip">
            <div className="avatar">{initial}</div>
            <div>
              <div className="uname">{user?.name}</div>
              {user?.role && <div className="role-badge">{user.role}</div>}
            </div>
          </div>
        </header>
        <main className={"content" + (alarm ? " alarm-flash" : "")}>
          {children}
        </main>
      </div>
    </div>
  );
}
