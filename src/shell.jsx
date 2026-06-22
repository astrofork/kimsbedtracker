import React, { useState, useCallback, useRef, useEffect, createContext, useContext } from "react";
import { Ic, icons, ThemeToggle } from "./ui.jsx";

// Lets a screen deep inside <AppShell>{children}</AppShell> (e.g. the admin
// dashboard) drop content into the profile dropdown in the topbar, without
// AppShell needing to know anything about that screen. Value is the slot DOM
// node while the dropdown is open, otherwise null — consumers should portal
// into it (see useProfileMenuSlot) and render nothing when it's null.
const ProfileMenuSlotContext = createContext(null);
export function useProfileMenuSlot() { return useContext(ProfileMenuSlotContext); }

// Same idea, but for the topbar itself rather than the dropdown — always
// mounted (no open/close gating), so a screen can portal small live-status
// content (e.g. "Live · 09:15 AM") next to the profile chip. Renders nothing
// extra when no screen is using it.
const TopBarSlotContext = createContext(null);
export function useTopBarSlot() { return useContext(TopBarSlotContext); }

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
 *  - Clicking the profile chip (top right) opens a dropdown. Screens further
 *    down the tree can inject content into it via useProfileMenuSlot() +
 *    createPortal — used by the admin dashboard for its layout controls.
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

  // Profile dropdown (top-right chip) — closes on outside click or Escape.
  const [profileOpen, setProfileOpen] = useState(false);
  const [profileSlot, setProfileSlot] = useState(null);
  const profileWrapRef = useRef(null);

  // Always-on topbar slot (next to the profile chip) — see TopBarSlotContext above.
  const [topBarSlot, setTopBarSlot] = useState(null);

  useEffect(() => {
    if (!profileOpen) return;
    const onPointerDown = (e) => {
      if (profileWrapRef.current && !profileWrapRef.current.contains(e.target)) setProfileOpen(false);
    };
    const onKeyDown = (e) => { if (e.key === "Escape") setProfileOpen(false); };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [profileOpen]);

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
          <span ref={setTopBarSlot} className="topbar-slot" />
          <ThemeToggle />
          <div className="profile-wrap" ref={profileWrapRef}>
            <button
              type="button"
              className="user-chip"
              onClick={() => setProfileOpen((o) => !o)}
              aria-haspopup="menu"
              aria-expanded={profileOpen}
            >
              <div className="avatar">{initial}</div>
              <div>
                <div className="uname">{user?.name}</div>
                {user?.role && <div className="role-badge">{user.role}</div>}
              </div>
              <Ic d={icons.chevron} s={13} className={"profile-chev" + (profileOpen ? " open" : "")} />
            </button>
            {profileOpen && (
              <div className="profile-menu" role="menu">
                <div className="profile-menu-head">
                  <div className="avatar">{initial}</div>
                  <div>
                    <div className="uname">{user?.name}</div>
                    {user?.role && <div className="role-badge">{user.role}</div>}
                  </div>
                </div>
                <div className="profile-menu-slot" ref={setProfileSlot} />
              </div>
            )}
          </div>
        </header>
        <main className={"content" + (alarm ? " alarm-flash" : "")}>
          <ProfileMenuSlotContext.Provider value={profileOpen ? profileSlot : null}>
            <TopBarSlotContext.Provider value={topBarSlot}>
              {children}
            </TopBarSlotContext.Provider>
          </ProfileMenuSlotContext.Provider>
        </main>
      </div>
    </div>
  );
}
