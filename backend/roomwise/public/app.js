(() => {
  const STORAGE_KEY = "roomwise-state-v1";
  const DEMO_CLASS_IDS = new Set([
    "c101", "c102", "c103", "c104", "c105", "c106",
    "c107", "c108", "c109", "c110", "c111", "c112"
  ]);
  const FACILITIES = ["Projector", "Smart board", "Lab PCs", "Recording"];
  const ALL_SLOTS = RoomAllocator.DAYS.flatMap(day =>
    RoomAllocator.PERIODS.map(period => RoomAllocator.slotKey(day, period.id))
  );

  const byId = id => document.getElementById(id);
  const escapeHTML = value => String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]);
  const periodLabel = id => RoomAllocator.PERIODS.find(period => period.id === id)?.label || id;
  const slotLabel = slot => {
    const [day, period] = slot.split("|");
    return `${day.slice(0, 3)} ${periodLabel(period)}`;
  };
  let toastTimer;

  async function api(method, url, body) {
    let response;
    try {
      response = await fetch(url, {
        method,
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined
      });
    } catch {
      setSaveStatus("Server unreachable", true);
      throw new Error("Cannot reach the Roomwise server.");
    }
    if (response.status === 204) return null;
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Request failed (${response.status}).`);
    return data;
  }

  function setSaveStatus(text, isError = false) {
    byId("save-status").textContent = text;
    document.querySelector(".saved-dot")?.classList.toggle("error-dot", isError);
  }

  const state = {
    rooms: [],
    classes: [],
    assignments: null,
    reasons: {},
    currentView: "rooms"
  };

  function applyAllocation(allocation) {
    state.assignments = allocation ? allocation.assignments : null;
    state.reasons = allocation ? allocation.reasons || {} : {};
  }

  // One-time migration: if this browser has data from the old localStorage version
  // and the server is empty, upload it so nothing is lost.
  async function migrateLocalData(serverState) {
    if (serverState.rooms.length || serverState.classes.length) return serverState;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return serverState;
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed.rooms) || !Array.isArray(parsed.classes)) return serverState;
      const rooms = parsed.rooms.map(room => ({
        ...room,
        roomNumber: room.roomNumber ?? room.name ?? "",
        block: room.block ?? room.building ?? "",
        availableSlots: Array.isArray(room.availableSlots) ? room.availableSlots : [...ALL_SLOTS],
        facilities: Array.isArray(room.facilities) ? room.facilities : []
      }));
      const classes = parsed.classes.filter(item => !DEMO_CLASS_IDS.has(String(item.id))).map(item => ({
        ...item,
        classNo: item.classNo ?? item.name ?? "",
        subject: item.subject ?? item.name ?? "",
        enrollment: Number(item.enrollment) || 1,
        preferredBlock: item.preferredBlock ?? item.preferredBuilding ?? "",
        facilities: Array.isArray(item.facilities) ? item.facilities : []
      }));
      if (!rooms.length && !classes.length) return serverState;
      const migrated = await api("PUT", "/api/state", { rooms, classes });
      localStorage.removeItem(STORAGE_KEY);
      showToast("Your earlier browser-saved data was moved to the server.");
      return migrated;
    } catch (error) {
      console.error("Could not migrate local data.", error);
      return serverState;
    }
  }

  async function loadState() {
    try {
      const serverState = await migrateLocalData(await api("GET", "/api/state"));
      state.rooms = serverState.rooms;
      state.classes = serverState.classes;
      applyAllocation(serverState.allocation);
      setSaveStatus("Changes saved");
    } catch (error) {
      console.error(error);
      showToast(error.message);
    }
    renderAll();
  }

  function renderAll() {
    renderRooms();
    renderClasses();
    renderAllocation();
    byId("room-nav-count").textContent = state.rooms.length;
    byId("class-nav-count").textContent = state.classes.length;
  }

  function renderRooms() {
    byId("rooms-heading").textContent = `${state.rooms.length} classroom${state.rooms.length === 1 ? "" : "s"}`;
    const grid = byId("room-grid");
    if (!state.rooms.length) {
      grid.innerHTML = '<div class="empty-state room-empty"><span>▦</span><strong>No classrooms saved yet</strong><p>Add a classroom with its number, block, seating capacity, projector, and available times.</p></div>';
      return;
    }
    grid.innerHTML = state.rooms.map(room => {
      const availability = room.availableSlots.length;
      const assigned = state.assignments
        ? Object.values(state.assignments).filter(id => id === room.id).length
        : null;
      return `<article class="room-card">
        <div class="room-card-top"><span class="room-building-icon">▦</span><button class="row-action" data-edit-room="${escapeHTML(room.id)}" aria-label="Edit room ${escapeHTML(room.roomNumber)}" title="Edit classroom">···</button></div>
        <h3>Room ${escapeHTML(room.roomNumber)}</h3><p class="room-building">${escapeHTML(room.block)}</p>
        <div class="room-card-stats"><div><strong>${room.capacity}</strong><span>seats</span></div><div><strong>${availability}</strong><span>available slots</span></div><div><strong>${assigned === null ? "—" : assigned}</strong><span>classes allocated</span></div></div>
        <div class="room-card-bottom"><div class="facility-list">${room.facilities.length ? room.facilities.map(facility => `<span class="facility-chip">${escapeHTML(facility)}</span>`).join("") : '<span class="muted">No listed facilities</span>'}</div></div>
      </article>`;
    }).join("");
    grid.querySelectorAll("[data-edit-room]").forEach(button => button.addEventListener("click", () => openRoomDialog(button.dataset.editRoom)));
  }

  function renderClasses() {
    byId("classes-heading").textContent = `${state.classes.length} needed class${state.classes.length === 1 ? "" : "es"}`;
    const body = byId("classes-table-body");
    if (!state.classes.length) {
      body.innerHTML = '<tr><td colspan="6"><div class="empty-state"><span>▤</span><strong>No needed classes entered</strong><p>Add the classes that need a classroom to create an allocation plan.</p></div></td></tr>';
      return;
    }
    body.innerHTML = state.classes.map(item => `<tr>
      <td><div class="class-cell"><span class="class-avatar">${escapeHTML(item.classNo.slice(0, 3).toUpperCase())}</span><span><strong>${escapeHTML(item.classNo)} · ${escapeHTML(item.subject)}</strong><small>${escapeHTML(item.department || "Class")}</small></span></div></td>
      <td><span class="enrollment-cell">${item.enrollment} <small>students</small></span></td>
      <td><span class="time-cell"><strong>${escapeHTML(item.day)}</strong>${escapeHTML(periodLabel(item.period))}</span></td>
      <td><div class="facility-list">${item.facilities.length ? item.facilities.map(facility => `<span class="facility-chip">${escapeHTML(facility)}</span>`).join("") : '<span class="muted">No special facilities</span>'}</div></td>
      <td><span class="department-label">${escapeHTML(item.preferredBlock || "Any block")}</span></td>
      <td><button class="row-action" data-edit-class="${escapeHTML(item.id)}" aria-label="Edit class ${escapeHTML(item.classNo)}" title="Edit class">···</button></td>
    </tr>`).join("");
    body.querySelectorAll("[data-edit-class]").forEach(button => button.addEventListener("click", () => openClassDialog(button.dataset.editClass)));
  }

  function renderAllocation() {
    const body = byId("allocation-table-body");
    const summary = byId("allocation-summary");
    if (!state.assignments) {
      byId("allocation-result-count").textContent = "No plan generated";
      summary.innerHTML = '<div class="allocation-placeholder"><span>✳</span><div><strong>Ready when you are</strong><p>Save available classrooms and enter needed classes, then choose <b>Generate allocation</b>.</p><button class="button button-quiet" data-navigate="rooms">Step 1: Add classrooms</button> <button class="button button-quiet" data-navigate="classes">Step 2: Enter classes</button></div></div>';
      summary.querySelectorAll("[data-navigate]").forEach(button => button.addEventListener("click", () => setView(button.dataset.navigate)));
      body.innerHTML = '<tr><td colspan="5"><div class="empty-state"><span>⌂</span><strong>No allocation generated</strong><p>Your room plan will appear here.</p></div></td></tr>';
      return;
    }
    const placed = state.classes.filter(item => state.assignments[item.id]).length;
    const unplaced = state.classes.length - placed;
    summary.innerHTML = `<div class="allocation-result-banner ${unplaced ? "has-unplaced" : ""}"><span class="allocation-result-icon">${unplaced ? "!" : "✓"}</span><div><strong>${placed} of ${state.classes.length} classes allocated</strong><p>${unplaced ? `${unplaced} class${unplaced === 1 ? "" : "es"} could not be matched. See the reason in the plan below.` : "All classes have a suitable room. Room clashes and unmet requirements are avoided."}</p></div><span class="allocation-ready">${unplaced ? "Review needed" : "Plan ready"}</span></div>`;
    byId("allocation-result-count").textContent = `${state.classes.length} class${state.classes.length === 1 ? "" : "es"}`;
    const ordered = state.classes.slice().sort((a, b) =>
      RoomAllocator.DAYS.indexOf(a.day) - RoomAllocator.DAYS.indexOf(b.day) ||
      RoomAllocator.PERIODS.findIndex(period => period.id === a.period) - RoomAllocator.PERIODS.findIndex(period => period.id === b.period)
    );
    if (!ordered.length) {
      body.innerHTML = '<tr><td colspan="5"><div class="empty-state"><span>▤</span><strong>No classes to allocate</strong><p>Add needed classes, then generate the plan.</p></div></td></tr>';
      return;
    }
    body.innerHTML = ordered.map(item => {
      const room = state.rooms.find(candidate => candidate.id === state.assignments[item.id]);
      const reason = room ? "" : (state.reasons[item.id] || "No suitable room found");
      return `<tr>
        <td><div class="class-cell"><span class="class-avatar">${escapeHTML(item.classNo.slice(0, 3).toUpperCase())}</span><span><strong>${escapeHTML(item.classNo)} · ${escapeHTML(item.subject)}</strong><small>${item.enrollment} students</small></span></div></td>
        <td><span class="time-cell"><strong>${escapeHTML(item.day)}</strong>${escapeHTML(periodLabel(item.period))}</span></td>
        <td>${room ? `<div class="room-cell"><strong>Room ${escapeHTML(room.roomNumber)}</strong><small>${escapeHTML(room.block)}</small></div>` : `<span class="unassigned-label"><span>!</span> ${escapeHTML(reason)}</span>`}</td>
        <td>${room ? `<span class="enrollment-cell">${item.enrollment} <small>/ ${room.capacity} seats</small></span>` : '<span class="muted">—</span>'}</td>
        <td><div class="facility-list">${item.facilities.length ? item.facilities.map(facility => `<span class="facility-chip">${escapeHTML(facility)}</span>`).join("") : '<span class="muted">None required</span>'}</div></td>
      </tr>`;
    }).join("");
  }

  function openRoomDialog(roomId) {
    const room = state.rooms.find(item => item.id === roomId);
    byId("dialog-kicker").textContent = room ? "UPDATE ROOM DETAILS" : "AVAILABLE CLASSROOM";
    byId("dialog-title").textContent = room ? "Edit classroom" : "Add classroom";
    byId("dialog-content").innerHTML = `
      <input type="hidden" name="entityType" value="room"><input type="hidden" name="entityId" value="${room ? escapeHTML(room.id) : ""}">
      <div class="form-row">
        <label class="form-field"><span>Classroom number</span><input name="roomNumber" required maxlength="30" placeholder="e.g. 101" value="${room ? escapeHTML(room.roomNumber) : ""}"></label>
        <label class="form-field"><span>Block / building</span><input name="block" required maxlength="50" placeholder="e.g. Main Block" value="${room ? escapeHTML(room.block) : ""}"></label>
      </div>
      <label class="form-field"><span>Number of seats</span><input name="capacity" required type="number" min="1" max="1000" placeholder="e.g. 60" value="${room ? room.capacity : ""}"></label>
      <fieldset class="form-field choice-field"><legend>Facilities available in this room</legend><div class="check-grid">${facilityCheckboxes(room?.facilities || [])}</div></fieldset>
      <fieldset class="form-field choice-field"><legend>When is this room available?</legend><div class="availability-grid">${availabilityCheckboxes(room?.availableSlots || ALL_SLOTS)}</div></fieldset>
      ${room ? '<button class="delete-button" type="button" data-delete-entity>Delete this classroom</button>' : ""}`;
    openDialog();
  }

  function openClassDialog(classId) {
    const item = state.classes.find(candidate => candidate.id === classId);
    byId("dialog-kicker").textContent = item ? "UPDATE CLASS REQUIREMENTS" : "NEEDED CLASS";
    byId("dialog-title").textContent = item ? "Edit needed class" : "Add needed class";
    byId("dialog-content").innerHTML = `
      <input type="hidden" name="entityType" value="class"><input type="hidden" name="entityId" value="${item ? escapeHTML(item.id) : ""}">
      <div class="form-row">
        <label class="form-field"><span>Class number / code</span><input name="classNo" required maxlength="30" placeholder="e.g. CS 101" value="${item ? escapeHTML(item.classNo) : ""}"></label>
        <label class="form-field"><span>Class name / subject</span><input name="subject" required maxlength="80" placeholder="e.g. Introduction to Computing" value="${item ? escapeHTML(item.subject) : ""}"></label>
      </div>
      <div class="form-row">
        <label class="form-field"><span>Number of students</span><input name="enrollment" required type="number" min="1" max="1000" placeholder="e.g. 45" value="${item ? item.enrollment : ""}"></label>
        <label class="form-field"><span>Department <small>(optional)</small></span><input name="department" maxlength="50" placeholder="e.g. Computer Science" value="${item ? escapeHTML(item.department || "") : ""}"></label>
      </div>
      <div class="form-row">
        <label class="form-field"><span>Day</span><select name="day" required>${RoomAllocator.DAYS.map(day => `<option value="${day}" ${item?.day === day ? "selected" : ""}>${day}</option>`).join("")}</select></label>
        <label class="form-field"><span>Class time</span><select name="period" required>${RoomAllocator.PERIODS.map(period => `<option value="${period.id}" ${item?.period === period.id ? "selected" : ""}>${period.label}</option>`).join("")}</select></label>
      </div>
      <label class="form-field"><span>Preferred block <small>(optional)</small></span><input name="preferredBlock" maxlength="50" placeholder="e.g. Main Block" value="${item ? escapeHTML(item.preferredBlock || "") : ""}"></label>
      <fieldset class="form-field choice-field"><legend>Required facilities</legend><div class="check-grid">${facilityCheckboxes(item?.facilities || [])}</div></fieldset>
      ${item ? '<button class="delete-button" type="button" data-delete-entity>Delete this needed class</button>' : ""}`;
    openDialog();
  }

  function facilityCheckboxes(selected) {
    return FACILITIES.map(facility => `<label class="check-option"><input type="checkbox" name="facilities" value="${facility}" ${selected.includes(facility) ? "checked" : ""}><span>${facility}</span></label>`).join("");
  }

  function availabilityCheckboxes(selected) {
    return `<div class="availability-head"><span>DAY</span>${RoomAllocator.PERIODS.map(period => `<span>${period.id}</span>`).join("")}</div>` +
      RoomAllocator.DAYS.map(day => `<div class="availability-row"><strong>${day.slice(0, 3)}</strong>${RoomAllocator.PERIODS.map(period => {
        const key = RoomAllocator.slotKey(day, period.id);
        return `<label class="availability-check" title="${day} ${period.label}"><input type="checkbox" name="availableSlots" value="${key}" ${selected.includes(key) ? "checked" : ""}><span></span></label>`;
      }).join("")}</div>`).join("");
  }

  function openDialog() {
    const dialog = byId("edit-dialog");
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
    byId("dialog-content").querySelector("[data-delete-entity]")?.addEventListener("click", deleteEntity);
  }

  function closeDialog() {
    const dialog = byId("edit-dialog");
    if (typeof dialog.close === "function") dialog.close();
    else dialog.removeAttribute("open");
  }

  async function handleFormSubmit(event) {
    event.preventDefault();
    const formData = new FormData(byId("edit-form"));
    const type = formData.get("entityType");
    const id = String(formData.get("entityId") || "");
    const isRoom = type === "room";
    const payload = isRoom ? {
      roomNumber: String(formData.get("roomNumber")).trim(),
      block: String(formData.get("block")).trim(),
      capacity: Number(formData.get("capacity")),
      facilities: formData.getAll("facilities").map(String),
      availableSlots: formData.getAll("availableSlots").map(String)
    } : {
      classNo: String(formData.get("classNo")).trim(),
      subject: String(formData.get("subject")).trim(),
      department: String(formData.get("department")).trim(),
      enrollment: Number(formData.get("enrollment")),
      day: String(formData.get("day")),
      period: String(formData.get("period")),
      preferredBlock: String(formData.get("preferredBlock")).trim(),
      facilities: formData.getAll("facilities").map(String)
    };
    const collection = isRoom ? "rooms" : "classes";
    try {
      setSaveStatus("Saving…");
      const saved = await api(id ? "PUT" : "POST", `/api/${collection}${id ? `/${encodeURIComponent(id)}` : ""}`, payload);
      state[collection] = id ? state[collection].map(existing => existing.id === id ? saved : existing) : [...state[collection], saved];
    } catch (error) {
      setSaveStatus("Save failed", true);
      showToast(error.message);
      return;
    }
    applyAllocation(null);
    setSaveStatus("Changes saved");
    renderAll();
    closeDialog();
    showToast(`${isRoom ? "Classroom" : "Needed class"} saved. Generate a new allocation when your details are ready.`);
  }

  async function deleteEntity() {
    const formData = new FormData(byId("edit-form"));
    const id = String(formData.get("entityId"));
    const collection = formData.get("entityType") === "room" ? "rooms" : "classes";
    try {
      await api("DELETE", `/api/${collection}/${encodeURIComponent(id)}`);
    } catch (error) {
      setSaveStatus("Save failed", true);
      showToast(error.message);
      return;
    }
    state[collection] = state[collection].filter(item => item.id !== id);
    applyAllocation(null);
    setSaveStatus("Changes saved");
    renderAll();
    closeDialog();
    showToast("Details deleted. Generate the allocation again after updating your requirements.");
  }

  async function allocate() {
    if (!state.rooms.length) {
      showToast("Add available classrooms before generating an allocation.");
      setView("rooms");
      return;
    }
    if (!state.classes.length) {
      showToast("Enter the needed classes before generating an allocation.");
      setView("classes");
      return;
    }
    try {
      const allocation = await api("POST", "/api/allocation");
      applyAllocation(allocation);
      renderRooms();
      renderAllocation();
      setView("allocation");
      showToast(`${allocation.placed} of ${allocation.total} needed classes allocated.`);
    } catch (error) {
      showToast(error.message);
    }
  }

  function showToast(message) {
    const toast = byId("toast");
    toast.textContent = message;
    toast.classList.add("show");
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toast.classList.remove("show"), 3400);
  }

  function setView(view) {
    state.currentView = view;
    document.querySelectorAll(".view-panel").forEach(panel => panel.classList.toggle("active", panel.id === `view-${view}`));
    document.querySelectorAll(".nav-link").forEach(button => button.classList.toggle("active", button.dataset.view === view));
    const titles = { rooms: "Available Classrooms", classes: "Needed Classes", allocation: "Class Allocation" };
    byId("breadcrumb-current").textContent = titles[view] || titles.rooms;
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  document.querySelectorAll(".nav-link").forEach(button => button.addEventListener("click", () => setView(button.dataset.view)));
  document.querySelectorAll("[data-navigate]").forEach(button => button.addEventListener("click", () => setView(button.dataset.navigate)));
  byId("add-room-button").addEventListener("click", () => openRoomDialog());
  byId("add-class-button").addEventListener("click", () => openClassDialog());
  byId("allocate-button").addEventListener("click", allocate);
  byId("regenerate-button").addEventListener("click", allocate);
  byId("edit-form").addEventListener("submit", handleFormSubmit);
  byId("dialog-close").addEventListener("click", closeDialog);
  byId("dialog-cancel").addEventListener("click", closeDialog);
  byId("edit-dialog").addEventListener("click", event => {
    if (event.target === byId("edit-dialog")) closeDialog();
  });

  loadState();
})();
