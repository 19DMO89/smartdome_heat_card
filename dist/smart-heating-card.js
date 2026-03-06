// smart-heating-card.js  v2.0
// Ablegen: www/smart-heating-card/smart-heating-card.js

class SmartHeatingCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._hass       = null;
    this._state      = null;
    this._tab        = "overview";
    this._editRoom   = null;   // room_id des gerade bearbeiteten Raums
    this._newRoomName = "";
    this._entities   = { thermostats: [], sensors: [] };
  }

  setConfig(config) { this._config = config; this._render(); }

  set hass(hass) {
    this._hass  = hass;
    const s     = hass.states["smart_heating.config"];
    this._state = s ? s.attributes : null;
    this._buildEntityLists();
    this._render();
  }

  _buildEntityLists() {
    if (!this._hass) return;
    this._entities.thermostats = Object.keys(this._hass.states)
      .filter(k => k.startsWith("climate.")).sort();
    this._entities.sensors = Object.keys(this._hass.states)
      .filter(k => {
        const s = this._hass.states[k];
        return s.attributes.device_class === "temperature"
          || (k.startsWith("sensor.") && k.toLowerCase().includes("temp"));
      }).sort();
  }

  _cfg(path, fallback = "") {
    if (!this._state) return fallback;
    return path.split(".").reduce((o, k) => (o == null ? fallback : o[k]), this._state) ?? fallback;
  }

  _rooms() { return this._cfg("rooms", {}); }

  _roomTemp(sensorId) {
    if (!this._hass || !sensorId) return null;
    const s = this._hass.states[sensorId];
    return s ? parseFloat(s.state) : null;
  }

  _isNight() {
    const now = new Date(), hm = now.getHours() * 60 + now.getMinutes();
    const [nh, nm] = this._cfg("night_start", "22:00").split(":").map(Number);
    const [mh, mm] = this._cfg("morning_boost_start", "05:00").split(":").map(Number);
    return hm >= nh * 60 + nm || hm < mh * 60 + mm;
  }

  async _svc(service, data) {
    await this._hass.callService("smart_heating", service, data);
  }

  _setTab(t)  { this._tab = t; this._editRoom = null; this._render(); }
  _editR(id)  { this._editRoom = id; this._tab = "rooms"; this._render(); }

  // ── RENDER ────────────────────────────────────────────────────────────────

  _render() {
    const root = this.shadowRoot;
    root.innerHTML = "";
    const style = document.createElement("style");
    style.textContent = this._css();
    root.appendChild(style);
    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML  = this._html();
    root.appendChild(card);
    this._bind(card);
  }

  _html() {
    return `
      ${this._renderHeader()}
      ${this._renderTabs()}
      <div class="content">
        ${ this._tab === "overview"  ? this._renderOverview()  : "" }
        ${ this._tab === "rooms"     ? this._renderRooms()     : "" }
        ${ this._tab === "schedule"  ? this._renderSchedule()  : "" }
        ${ this._tab === "settings"  ? this._renderSettings()  : "" }
      </div>`;
  }

  _renderHeader() {
    const night = this._isNight();
    const rooms = this._rooms();
    const cnt   = Object.keys(rooms).length;
    return `
      <div class="header">
        <div class="header-icon">${night ? "🌙" : "☀️"}</div>
        <div class="header-text">
          <div class="title">Smart Heizung</div>
          <div class="subtitle">${cnt} Räume konfiguriert · ${night ? "Nachtmodus" : "Tagbetrieb"}</div>
        </div>
        <div class="status-pill ${night ? "night" : "day"}">${night ? "Nacht" : "Tag"}</div>
      </div>`;
  }

  _renderTabs() {
    const tabs = [
      { id: "overview", icon: "🏠", label: "Übersicht" },
      { id: "rooms",    icon: "🌡", label: "Räume"    },
      { id: "schedule", icon: "⏰", label: "Zeiten"   },
      { id: "settings", icon: "⚙️",  label: "Einst."   },
    ];
    return `<div class="tabs">
      ${tabs.map(t => `
        <button class="tab ${this._tab === t.id ? "active" : ""}" data-tab="${t.id}">
          <span>${t.icon}</span> ${t.label}
        </button>`).join("")}
    </div>`;
  }

  // ── ÜBERSICHT ─────────────────────────────────────────────────────────────

  _renderOverview() {
    const rooms  = this._rooms();
    const night  = this._isNight();
    const mainId = this._cfg("main_thermostat");
    const mainS  = this._hass?.states[mainId];
    const mCur   = mainS ? parseFloat(mainS.attributes.current_temperature || 0).toFixed(1) : "—";
    const mSet   = mainS ? parseFloat(mainS.attributes.temperature         || 0).toFixed(1) : "—";

    const noRooms = Object.keys(rooms).length === 0;

    return `
      <div class="main-card">
        <div class="main-card-left">
          <div class="main-label">Hauptthermostat</div>
          <div class="main-entity">${mainId || "⚠ nicht konfiguriert"}</div>
        </div>
        <div class="main-temps">
          <div class="main-block"><div class="main-val">${mCur}°</div><div class="main-desc">Aktuell</div></div>
          <div class="main-divider"></div>
          <div class="main-block"><div class="main-val">${mSet}°</div><div class="main-desc">Soll</div></div>
        </div>
      </div>

      ${noRooms ? `
        <div class="empty-state">
          <div class="empty-icon">🏠</div>
          <div class="empty-title">Noch keine Räume konfiguriert</div>
          <div class="empty-sub">Wechsle zum Tab „Räume" um deinen ersten Raum hinzuzufügen.</div>
          <button class="btn-primary" data-tab="rooms">Räume verwalten →</button>
        </div>
      ` : `
        <div class="room-grid">
          ${Object.entries(rooms).map(([id, room]) => this._renderRoomCard(id, room, night)).join("")}
        </div>
      `}`;
  }

  _renderRoomCard(id, room, night) {
    const target  = night ? room.target_night : room.target_day;
    const temp    = this._roomTemp(room.sensor);
    const diff    = temp != null ? temp - target : null;
    const status  = diff == null ? "unknown" : diff < -0.5 ? "cold" : diff > 0.5 ? "warm" : "ok";
    const icons   = { cold: "🥶", warm: "🔥", ok: "✅", unknown: "❓" };
    const noTherm = !room.thermostat;
    const noSens  = !room.sensor;

    return `
      <div class="room-card ${status} ${!room.enabled ? "disabled" : ""}">
        <div class="rc-top">
          <span class="rc-icon">${icons[status]}</span>
          <span class="rc-name">${room.label}</span>
          <button class="rc-edit" data-edit="${id}" title="Bearbeiten">✏️</button>
        </div>
        <div class="rc-temps">
          <span class="rc-cur">${temp != null ? temp.toFixed(1) + "°" : "—"}</span>
          <span class="rc-arrow">→</span>
          <span class="rc-tgt">${target}°</span>
        </div>
        <div class="rc-badges">
          ${noTherm ? '<span class="badge grey">kein Thermostat</span>' : '<span class="badge green">Thermostat ✓</span>'}
          ${noSens  ? '<span class="badge grey">kein Sensor</span>'    : '<span class="badge blue">Sensor ✓</span>'}
        </div>
      </div>`;
  }

  // ── RÄUME ─────────────────────────────────────────────────────────────────

  _renderRooms() {
    const rooms = this._rooms();
    const ids   = Object.keys(rooms);

    // Wenn ein Raum zum Bearbeiten ausgewählt ist
    if (this._editRoom && rooms[this._editRoom]) {
      return this._renderRoomEditor(this._editRoom, rooms[this._editRoom]);
    }

    return `
      <div class="rooms-list">
        ${ids.length === 0 ? `
          <div class="empty-state">
            <div class="empty-icon">🏠</div>
            <div class="empty-title">Noch keine Räume vorhanden</div>
            <div class="empty-sub">Füge unten deinen ersten Raum hinzu.</div>
          </div>
        ` : ids.map(id => this._renderRoomRow(id, rooms[id])).join("")}
      </div>

      <div class="add-room-section">
        <div class="add-room-title">➕ Neuen Raum hinzufügen</div>
        <div class="add-room-row">
          <input type="text" class="text-input" id="new-room-name"
            placeholder="z. B. Schlafzimmer, Bad, Büro …"
            value="${this._newRoomName}" />
          <button class="btn-primary" data-action="add-room">Hinzufügen</button>
        </div>
        <p class="hint">Sensor und Thermostat kannst du danach zuweisen. Räume ohne Thermostat werden über das Hauptthermostat mitgeheizt.</p>
      </div>`;
  }

  _renderRoomRow(id, room) {
    const hasT = !!room.thermostat;
    const hasS = !!room.sensor;
    return `
      <div class="room-row">
        <div class="room-row-left">
          <label class="toggle-wrap">
            <input type="checkbox" class="toggle-cb" data-toggle-room="${id}" ${room.enabled !== false ? "checked" : ""} />
            <span class="toggle-slider"></span>
          </label>
          <div class="room-row-info">
            <div class="room-row-name">${room.label}</div>
            <div class="room-row-sub">
              ${hasT ? "🌡 Thermostat" : "🔧 kein Thermostat"}
              &nbsp;·&nbsp;
              ${hasS ? "📡 Sensor" : "📡 kein Sensor"}
              &nbsp;·&nbsp;
              ☀️ ${room.target_day}° / 🌙 ${room.target_night}°
            </div>
          </div>
        </div>
        <div class="room-row-actions">
          <button class="btn-icon" data-edit="${id}" title="Bearbeiten">✏️</button>
          <button class="btn-icon danger" data-delete="${id}" title="Löschen">🗑</button>
        </div>
      </div>`;
  }

  _renderRoomEditor(id, room) {
    return `
      <div class="editor-header">
        <button class="btn-back" data-action="back">← Zurück</button>
        <div class="editor-title">Raum bearbeiten</div>
      </div>

      <div class="editor-body">
        <div class="field-group">
          <label>Raumname</label>
          <input type="text" class="text-input" data-path="rooms.${id}.label" value="${room.label}" />
        </div>

        <div class="field-group">
          <label>Heizkörperthermostat <span class="optional">(optional)</span></label>
          <select class="select-input" data-path="rooms.${id}.thermostat">
            <option value="">— kein smartes Thermostat —</option>
            ${this._entities.thermostats.map(e =>
              `<option value="${e}" ${room.thermostat === e ? "selected" : ""}>${e}</option>`
            ).join("")}
          </select>
          <p class="hint">Ohne Thermostat wird dieser Raum nur über das Hauptthermostat mitgeheizt.</p>
        </div>

        <div class="field-group">
          <label>Temperatursensor <span class="optional">(optional)</span></label>
          <select class="select-input" data-path="rooms.${id}.sensor">
            <option value="">— kein Sensor —</option>
            ${this._entities.sensors.map(e =>
              `<option value="${e}" ${room.sensor === e ? "selected" : ""}>${e}</option>`
            ).join("")}
          </select>
          <p class="hint">Ohne Sensor kann keine Temperaturregelung für diesen Raum stattfinden.</p>
        </div>

        <div class="temp-grid">
          <div class="slider-block">
            <label>☀️ Tagessolltemperatur</label>
            <div class="slider-row">
              <input type="range" min="15" max="27" step="0.5"
                class="slider day-slider" data-path="rooms.${id}.target_day"
                value="${room.target_day}" />
              <span class="slider-val" data-val="rooms.${id}.target_day">${room.target_day}°C</span>
            </div>
          </div>
          <div class="slider-block">
            <label>🌙 Nachtsolltemperatur</label>
            <div class="slider-row">
              <input type="range" min="12" max="22" step="0.5"
                class="slider night-slider" data-path="rooms.${id}.target_night"
                value="${room.target_night}" />
              <span class="slider-val" data-val="rooms.${id}.target_night">${room.target_night}°C</span>
            </div>
          </div>
        </div>

        <button class="btn-primary full" data-save-room="${id}">💾 Speichern</button>
      </div>`;
  }

  // ── ZEITEN ────────────────────────────────────────────────────────────────

  _renderSchedule() {
    return `
      <div class="schedule-wrap">
        <div class="section-title">🌙 Nachtmodus & Morgen-Boost</div>

        <div class="two-col">
          <div class="field-group">
            <label>Nacht beginnt</label>
            <input type="time" class="time-input" data-path="night_start"
              value="${this._cfg("night_start", "22:00")}" />
          </div>
          <div class="field-group">
            <label>Morgen-Boost startet</label>
            <input type="time" class="time-input" data-path="morning_boost_start"
              value="${this._cfg("morning_boost_start", "05:00")}" />
          </div>
        </div>

        <div class="field-group">
          <label>Tagbetrieb beginnt (Boost endet)</label>
          <input type="time" class="time-input" data-path="morning_boost_end"
            value="${this._cfg("morning_boost_end", "05:30")}" />
        </div>

        <div class="timeline-wrap">
          <div class="tl-bar">
            <div class="tl-seg day"  style="flex:6"><span>☀️ Tag</span></div>
            <div class="tl-seg night" style="flex:3.5"><span>🌙 Nacht</span></div>
            <div class="tl-seg boost" style="flex:0.5"><span>🔥</span></div>
          </div>
          <div class="tl-labels">
            <span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>24:00</span>
          </div>
        </div>

        <button class="btn-primary full" data-save="schedule">💾 Zeiten speichern</button>
      </div>`;
  }

  // ── EINSTELLUNGEN ─────────────────────────────────────────────────────────

  _renderSettings() {
    return `
      <div class="settings-wrap">
        <div class="section-title">⚙️ Globale Einstellungen</div>

        <div class="field-group">
          <label>Hauptthermostat</label>
          <select class="select-input" data-path="main_thermostat">
            <option value="">— auswählen —</option>
            ${this._entities.thermostats.map(e =>
              `<option value="${e}" ${this._cfg("main_thermostat") === e ? "selected" : ""}>${e}</option>`
            ).join("")}
          </select>
          <p class="hint">Das zentrale Thermostat, das die Heizanlage ein/ausschaltet.</p>
        </div>

        <div class="slider-block">
          <label>🚀 Boost-Delta</label>
          <div class="slider-row">
            <input type="range" min="0.5" max="5" step="0.5" class="slider day-slider"
              data-path="boost_delta" value="${this._cfg("boost_delta", 2)}" />
            <span class="slider-val" data-val="boost_delta">${this._cfg("boost_delta", 2)}°C</span>
          </div>
          <p class="hint">Um wie viel °C wird das Hauptthermostat angehoben, wenn ein Raum zu kalt ist.</p>
        </div>

        <div class="slider-block">
          <label>🎯 Toleranz</label>
          <div class="slider-row">
            <input type="range" min="0.1" max="2" step="0.1" class="slider night-slider"
              data-path="tolerance" value="${this._cfg("tolerance", 0.5)}" />
            <span class="slider-val" data-val="tolerance">${this._cfg("tolerance", 0.5)}°C</span>
          </div>
          <p class="hint">Wie viel ein Raum unter dem Sollwert liegen darf, bevor eingegriffen wird.</p>
        </div>

        <button class="btn-primary full" data-save="settings">💾 Einstellungen speichern</button>
      </div>`;
  }

  // ── EVENTS ────────────────────────────────────────────────────────────────

  _bind(card) {
    // Tabs
    card.querySelectorAll(".tab").forEach(b =>
      b.addEventListener("click", () => this._setTab(b.dataset.tab))
    );

    // Overview → Rooms button
    card.querySelectorAll("[data-tab]").forEach(b =>
      b.addEventListener("click", () => this._setTab(b.dataset.tab))
    );

    // Raum bearbeiten (edit-Icon)
    card.querySelectorAll("[data-edit]").forEach(b =>
      b.addEventListener("click", () => this._editR(b.dataset.edit))
    );

    // Zurück-Button im Editor
    card.querySelector("[data-action='back']")?.addEventListener("click", () => {
      this._editRoom = null; this._render();
    });

    // Raum hinzufügen
    card.querySelector("[data-action='add-room']")?.addEventListener("click", async () => {
      const inp = card.querySelector("#new-room-name");
      const name = inp?.value.trim();
      if (!name) { this._toast("⚠️ Bitte einen Raumnamen eingeben."); return; }
      this._newRoomName = "";
      await this._svc("add_room", { label: name });
      this._toast(`✅ Raum „${name}" hinzugefügt`);
    });

    // Raum löschen
    card.querySelectorAll("[data-delete]").forEach(b =>
      b.addEventListener("click", async () => {
        const id = b.dataset.delete;
        const rooms = this._rooms();
        if (confirm(`Raum „${rooms[id]?.label || id}" wirklich löschen?`)) {
          await this._svc("remove_room", { room_id: id });
          this._toast("🗑 Raum gelöscht");
        }
      })
    );

    // Toggle aktivieren/deaktivieren
    card.querySelectorAll(".toggle-cb").forEach(cb =>
      cb.addEventListener("change", async (e) => {
        const id = e.target.dataset.toggleRoom;
        await this._svc("update_config", {
          config: { rooms: { [id]: { enabled: e.target.checked } } }
        });
      })
    );

    // Slider live-preview
    card.querySelectorAll(".slider").forEach(s =>
      s.addEventListener("input", (e) => {
        const valEl = card.querySelector(`[data-val="${e.target.dataset.path}"]`);
        if (valEl) valEl.textContent = e.target.value + "°C";
      })
    );

    // Raum-Speichern im Editor
    card.querySelectorAll("[data-save-room]").forEach(b =>
      b.addEventListener("click", async () => {
        const id      = b.dataset.saveRoom;
        const editor  = b.closest(".editor-body");
        const patch   = { rooms: { [id]: {} } };
        editor.querySelectorAll("[data-path]").forEach(el => {
          const path   = el.dataset.path;
          const parts  = path.split(".");
          const val    = el.tagName === "INPUT" && el.type === "range"
            ? parseFloat(el.value) : el.value;
          // Nur rooms.{id}.{field} setzen
          if (parts.length === 3 && parts[0] === "rooms" && parts[1] === id) {
            patch.rooms[id][parts[2]] = val;
          }
        });
        await this._svc("update_config", { config: patch });
        this._editRoom = null;
        this._toast("✅ Raum gespeichert");
      })
    );

    // Zeiten speichern
    card.querySelector("[data-save='schedule']")?.addEventListener("click", async () => {
      await this._svc("update_config", { config: {
        night_start:         card.querySelector("[data-path='night_start']")?.value,
        morning_boost_start: card.querySelector("[data-path='morning_boost_start']")?.value,
        morning_boost_end:   card.querySelector("[data-path='morning_boost_end']")?.value,
      }});
      this._toast("✅ Zeiten gespeichert");
    });

    // Einstellungen speichern
    card.querySelector("[data-save='settings']")?.addEventListener("click", async () => {
      await this._svc("update_config", { config: {
        main_thermostat: card.querySelector("[data-path='main_thermostat']")?.value,
        boost_delta:     parseFloat(card.querySelector("[data-path='boost_delta']")?.value || 2),
        tolerance:       parseFloat(card.querySelector("[data-path='tolerance']")?.value   || 0.5),
      }});
      this._toast("✅ Einstellungen gespeichert");
    });

    // Neue Raum-Name zwischenspeichern
    card.querySelector("#new-room-name")?.addEventListener("input", (e) => {
      this._newRoomName = e.target.value;
    });
  }

  _toast(msg) {
    const t = document.createElement("div");
    t.className   = "toast";
    t.textContent = msg;
    this.shadowRoot.appendChild(t);
    setTimeout(() => t.remove(), 2800);
  }

  // ── CSS ───────────────────────────────────────────────────────────────────

  _css() {
    return `
      :host {
        --bg:      #0f1117;  --bg2: #181c27;  --bg3: #1e2436;
        --border:  #2a3050;
        --accent:  #ff6b35;  --accent2: #4fc3f7;
        --night:   #7c83ff;  --ok: #43d08a;
        --warn:    #ffd166;  --text: #e8eaf6;  --muted: #7986cb;
        --radius:  14px;
        font-family: 'Segoe UI', system-ui, sans-serif;
      }
      * { box-sizing: border-box; }

      .card { background: var(--bg); border-radius: var(--radius); padding: 18px;
               color: var(--text); border: 1px solid var(--border); position: relative; }

      /* HEADER */
      .header { display: flex; align-items: center; gap: 14px;
                 margin-bottom: 18px; padding-bottom: 14px; border-bottom: 1px solid var(--border); }
      .header-icon { font-size: 2em; }
      .title { font-size: 1.2em; font-weight: 700; }
      .subtitle { font-size: .78em; color: var(--muted); margin-top: 2px; }
      .status-pill { margin-left: auto; padding: 4px 12px; border-radius: 20px;
                      font-size: .72em; font-weight: 700; }
      .status-pill.day   { background: #ff6b3520; color: var(--accent); border: 1px solid #ff6b3540; }
      .status-pill.night { background: #7c83ff20; color: var(--night);  border: 1px solid #7c83ff40; }

      /* TABS */
      .tabs { display: flex; gap: 5px; background: var(--bg2); padding: 4px;
               border-radius: 12px; border: 1px solid var(--border); margin-bottom: 18px; }
      .tab { flex: 1; background: none; border: none; color: var(--muted); padding: 8px 4px;
              border-radius: 9px; cursor: pointer; font-size: .75em; font-weight: 600;
              transition: all .2s; }
      .tab:hover { background: var(--bg3); color: var(--text); }
      .tab.active { background: var(--bg3); color: var(--accent); border: 1px solid var(--border); }

      /* MAIN CARD */
      .main-card { background: linear-gradient(135deg,var(--bg2),var(--bg3));
                    border: 1px solid var(--border); border-radius: 12px;
                    padding: 14px 18px; margin-bottom: 14px;
                    display: flex; align-items: center; gap: 16px; }
      .main-card-left { flex: 1; }
      .main-label { font-size: .72em; color: var(--muted); font-weight: 700;
                     text-transform: uppercase; letter-spacing: .07em; }
      .main-entity { font-size: .82em; color: var(--accent2); font-family: monospace; margin-top: 4px; }
      .main-temps { display: flex; align-items: center; gap: 16px; }
      .main-block { text-align: center; }
      .main-val { font-size: 1.7em; font-weight: 800; }
      .main-desc { font-size: .7em; color: var(--muted); }
      .main-divider { width: 1px; height: 36px; background: var(--border); }

      /* ROOM GRID */
      .room-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 10px; }
      .room-card { background: var(--bg2); border: 1px solid var(--border); border-radius: 12px;
                    padding: 12px; transition: border-color .2s; }
      .room-card.cold    { border-color: #4fc3f750; }
      .room-card.warm    { border-color: #ff6b3550; }
      .room-card.ok      { border-color: #43d08a50; }
      .room-card.disabled { opacity: .45; }
      .rc-top { display: flex; align-items: center; gap: 6px; margin-bottom: 8px; }
      .rc-icon { font-size: 1.2em; }
      .rc-name { font-size: .8em; font-weight: 700; flex: 1; }
      .rc-edit { background: none; border: none; cursor: pointer; font-size: .9em; padding: 0; opacity: .5; }
      .rc-edit:hover { opacity: 1; }
      .rc-temps { display: flex; align-items: baseline; gap: 4px; margin-bottom: 8px; }
      .rc-cur { font-size: 1.4em; font-weight: 800; }
      .rc-arrow { color: var(--muted); }
      .rc-tgt { font-size: .85em; color: var(--muted); }
      .rc-badges { display: flex; flex-direction: column; gap: 3px; }

      /* BADGE */
      .badge { font-size: .65em; padding: 2px 7px; border-radius: 10px; font-weight: 600; }
      .badge.green { background: #43d08a20; color: var(--ok);    border: 1px solid #43d08a40; }
      .badge.blue  { background: #4fc3f720; color: var(--accent2); border: 1px solid #4fc3f740; }
      .badge.grey  { background: #ffffff10; color: var(--muted); border: 1px solid #ffffff15; }

      /* ROOMS LIST */
      .rooms-list { display: flex; flex-direction: column; gap: 8px; margin-bottom: 18px; }
      .room-row { background: var(--bg2); border: 1px solid var(--border); border-radius: 10px;
                   padding: 12px 14px; display: flex; align-items: center; gap: 12px; }
      .room-row-left { display: flex; align-items: center; gap: 12px; flex: 1; min-width: 0; }
      .room-row-info { min-width: 0; }
      .room-row-name { font-weight: 700; font-size: .9em; }
      .room-row-sub { font-size: .72em; color: var(--muted); margin-top: 2px; white-space: nowrap;
                       overflow: hidden; text-overflow: ellipsis; }
      .room-row-actions { display: flex; gap: 6px; }

      /* TOGGLE */
      .toggle-wrap { display: flex; align-items: center; cursor: pointer; flex-shrink: 0; }
      .toggle-cb { display: none; }
      .toggle-slider { width: 36px; height: 20px; background: var(--border); border-radius: 10px;
                         position: relative; transition: background .2s; }
      .toggle-slider::after { content: ""; position: absolute; top: 3px; left: 3px;
                                width: 14px; height: 14px; border-radius: 50%;
                                background: white; transition: left .2s; }
      .toggle-cb:checked + .toggle-slider { background: var(--ok); }
      .toggle-cb:checked + .toggle-slider::after { left: 19px; }

      /* ADD ROOM */
      .add-room-section { background: var(--bg2); border: 1px dashed var(--border);
                            border-radius: 10px; padding: 14px; }
      .add-room-title { font-weight: 700; font-size: .9em; margin-bottom: 10px; }
      .add-room-row { display: flex; gap: 8px; }
      .add-room-row .text-input { flex: 1; }

      /* EDITOR */
      .editor-header { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; }
      .editor-title { font-weight: 700; font-size: 1em; }
      .editor-body { display: flex; flex-direction: column; gap: 4px; }

      /* SCHEDULE */
      .schedule-wrap, .settings-wrap { display: flex; flex-direction: column; gap: 4px; }
      .section-title { font-weight: 700; font-size: .95em; margin-bottom: 10px; }
      .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
      .timeline-wrap { margin: 14px 0; }
      .tl-bar { display: flex; height: 28px; border-radius: 8px; overflow: hidden; margin-bottom: 5px; }
      .tl-seg { display: flex; align-items: center; justify-content: center;
                  font-size: .7em; font-weight: 700; }
      .tl-seg.day   { background: #ff6b3530; color: var(--accent); }
      .tl-seg.night { background: #7c83ff30; color: var(--night); }
      .tl-seg.boost { background: #43d08a30; color: var(--ok); }
      .tl-labels { display: flex; justify-content: space-between;
                    font-size: .68em; color: var(--muted); }

      /* FIELDS */
      .field-group { margin-bottom: 10px; }
      label { display: block; font-size: .75em; color: var(--muted); font-weight: 700;
               text-transform: uppercase; letter-spacing: .05em; margin-bottom: 5px; }
      .optional { text-transform: none; font-weight: 400; font-size: .9em; color: var(--muted); }
      .text-input, .select-input, .time-input {
        width: 100%; background: var(--bg2); border: 1px solid var(--border);
        color: var(--text); border-radius: 8px; padding: 9px 12px;
        font-size: .88em; outline: none; transition: border-color .2s;
      }
      .text-input:focus, .select-input:focus, .time-input:focus { border-color: var(--accent2); }
      .hint { font-size: .72em; color: var(--muted); margin: 4px 0 0; line-height: 1.4; }

      /* SLIDERS */
      .temp-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin: 8px 0; }
      .slider-block { margin-bottom: 10px; }
      .slider-row { display: flex; align-items: center; gap: 10px; margin-top: 6px; }
      .slider { flex: 1; -webkit-appearance: none; height: 5px; border-radius: 3px; outline: none; cursor: pointer; }
      .day-slider   { background: linear-gradient(to right, var(--accent), #ffd166); }
      .night-slider { background: linear-gradient(to right, var(--night), var(--accent2)); }
      .slider::-webkit-slider-thumb { -webkit-appearance: none; width: 18px; height: 18px;
        border-radius: 50%; background: white; border: 2px solid var(--accent);
        cursor: pointer; box-shadow: 0 2px 6px rgba(0,0,0,.4); }
      .slider-val { font-size: .82em; font-weight: 700; min-width: 44px; text-align: right; color: var(--accent); }

      /* BUTTONS */
      .btn-primary { background: linear-gradient(135deg, var(--accent), #ff8c5a); color: white;
                      border: none; padding: 9px 18px; border-radius: 8px; cursor: pointer;
                      font-size: .84em; font-weight: 700; transition: opacity .2s, transform .1s;
                      white-space: nowrap; }
      .btn-primary:hover { opacity: .9; }
      .btn-primary:active { transform: scale(.97); }
      .btn-primary.full { width: 100%; margin-top: 8px; }
      .btn-back { background: var(--bg3); color: var(--text); border: 1px solid var(--border);
                   padding: 7px 14px; border-radius: 8px; cursor: pointer; font-size: .82em;
                   font-weight: 600; transition: background .2s; }
      .btn-back:hover { background: var(--border); }
      .btn-icon { background: none; border: none; cursor: pointer; font-size: 1em;
                   padding: 4px 6px; border-radius: 6px; transition: background .15s; }
      .btn-icon:hover { background: var(--bg3); }
      .btn-icon.danger:hover { background: #ff000020; }

      /* EMPTY STATE */
      .empty-state { text-align: center; padding: 32px 16px; }
      .empty-icon  { font-size: 2.5em; margin-bottom: 10px; }
      .empty-title { font-weight: 700; font-size: 1em; margin-bottom: 6px; }
      .empty-sub   { font-size: .82em; color: var(--muted); margin-bottom: 16px; }

      /* TOAST */
      .toast { position: fixed; bottom: 22px; left: 50%; transform: translateX(-50%);
                background: var(--bg3); border: 1px solid var(--ok); color: var(--ok);
                padding: 9px 20px; border-radius: 30px; font-weight: 700;
                font-size: .88em; z-index: 9999; animation: fadeUp .2s; }
      @keyframes fadeUp { from { opacity: 0; transform: translateX(-50%) translateY(8px); } }
    `;
  }

  getCardSize() { return 6; }
  static getStubConfig() { return {}; }
}

customElements.define("smart-heating-card", SmartHeatingCard);
window.customCards = window.customCards || [];
window.customCards.push({
  type: "smart-heating-card",
  name: "Smart Heizung",
  description: "Dynamische Heizungssteuerung mit beliebig vielen Räumen.",
});
