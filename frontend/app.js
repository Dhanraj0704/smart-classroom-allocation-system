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

  function readStoredState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return { rooms: [], classes: [] };
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed.rooms) || !Array.isArray(parsed.classes)) {
        throw new Error("Saved classroom data has an invalid format.");
      }
      const classes = parsed.classes.filter(item => !DEMO_CLASS_IDS.has(String(item.id)));
      if (classes.length !== parsed.classes.length) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ rooms: parsed.rooms, classes }));
      }
      return {
        rooms: parsed.rooms.map(room => ({
          ...room,
          roomNumber: room.roomNumber ?? room.name ?? "",
          block: room.block ?? room.building ?? "",
          availableSlots: Array.isArray(room.availableSlots) ? room.availableSlots : [...ALL_SLOTS],
          facilities: Array.isArray(room.facilities) ? room.facilities : []
        })),
        classes: classes.map(item => ({
          ...item,
          classNo: item.classNo ?? item.name ?? "",
          name: item.subject ?? item.name ?? "",
          subject: item.subject ?? item.name ?? "",
          enrollment: Number(item.enrollment) || 1,
          preferredBlock: item.preferredBlock ?? item.preferredBuilding ?? "",
          facilities: Array.isArray(item.facilities) ? item.facilities : []
        }))
      };
    } catch (error) {
      console.error("Unable to read the saved classroom details.", error);
      return { rooms: [], classes: [] };
    }
  }

  const saved = readStoredState();
  const state = {
    rooms: saved.rooms,
    classes: saved.classes,
    assignments: null,
    currentView: "rooms"
  };

  function invalidateAllocation() {
    state.assignments = null;
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ rooms: state.rooms, classes: state.classes }));
      byId("save-status").textContent = "Changes saved";
    } catch (error) {
      console.error("Unable to save the classroom details.", error);
      byId("save-status").textContent = "Save failed";
      showToast("Could not save changes in this browser.");
    }
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
      const reason = room ? "" : unassignedReason(item);
      return `<tr>
        <td><div class="class-cell"><span class="class-avatar">${escapeHTML(item.classNo.slice(0, 3).toUpperCase())}</span><span><strong>${escapeHTML(item.classNo)} · ${escapeHTML(item.subject)}</strong><small>${item.enrollment} students</small></span></div></td>
        <td><span class="time-cell"><strong>${escapeHTML(item.day)}</strong>${escapeHTML(periodLabel(item.period))}</span></td>
        <td>${room ? `<div class="room-cell"><strong>Room ${escapeHTML(room.roomNumber)}</strong><small>${escapeHTML(room.block)}</small></div>` : `<span class="unassigned-label"><span>!</span> ${escapeHTML(reason)}</span>`}</td>
        <td>${room ? `<span class="enrollment-cell">${item.enrollment} <small>/ ${room.capacity} seats</small></span>` : '<span class="muted">—</span>'}</td>
        <td><div class="facility-list">${item.facilities.length ? item.facilities.map(facility => `<span class="facility-chip">${escapeHTML(facility)}</span>`).join("") : '<span class="muted">None required</span>'}</div></td>
      </tr>`;
    }).join("");
  }

  function unassignedReason(item) {
    if (!state.rooms.length) return "Add classrooms first";
    const enoughCapacity = state.rooms.filter(room => room.capacity >= item.enrollment);
    if (!enoughCapacity.length) return "Not enough seats";
    const facilitiesAvailable = enoughCapacity.filter(room => item.facilities.every(facility => room.facilities.includes(facility)));
    if (!facilitiesAvailable.length) return "Required facilities unavailable";
    const availableAtTime = facilitiesAvailable.filter(room => room.availableSlots.includes(RoomAllocator.slotKey(item.day, item.period)));
    if (!availableAtTime.length) return "No room available at this time";
    return "All suitable rooms are in use";
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

  function handleFormSubmit(event) {
    event.preventDefault();
    const formData = new FormData(byId("edit-form"));
    const type = formData.get("entityType");
    const id = String(formData.get("entityId") || "");
    if (type === "room") {
      const room = {
        id: id || createId("r"),
        roomNumber: String(formData.get("roomNumber")).trim(),
        block: String(formData.get("block")).trim(),
        capacity: Number(formData.get("capacity")),
        facilities: formData.getAll("facilities").map(String),
        availableSlots: formData.getAll("availableSlots").map(String)
      };
      const duplicate = state.rooms.some(existing =>
        existing.id !== id &&
        existing.roomNumber.toLowerCase() === room.roomNumber.toLowerCase() &&
        existing.block.toLowerCase() === room.block.toLowerCase()
      );
      if (duplicate) {
        showToast("A classroom with this number already exists in that block.");
        return;
      }
      if (id) state.rooms = state.rooms.map(existing => existing.id === id ? room : existing);
      else state.rooms.push(room);
    } else {
      const item = {
        id: id || createId("c"),
        classNo: String(formData.get("classNo")).trim(),
        subject: String(formData.get("subject")).trim(),
        name: String(formData.get("subject")).trim(),
        department: String(formData.get("department")).trim(),
        enrollment: Number(formData.get("enrollment")),
        day: String(formData.get("day")),
        period: String(formData.get("period")),
        preferredBlock: String(formData.get("preferredBlock")).trim(),
        facilities: formData.getAll("facilities").map(String)
      };
      const duplicate = state.classes.some(existing =>
        existing.id !== id && existing.classNo.toLowerCase() === item.classNo.toLowerCase()
      );
      if (duplicate) {
        showToast("A needed class with this number is already saved.");
        return;
      }
      if (id) state.classes = state.classes.map(existing => existing.id === id ? item : existing);
      else state.classes.push(item);
    }
    invalidateAllocation();
    saveState();
    renderAll();
    closeDialog();
    showToast(`${type === "room" ? "Classroom" : "Needed class"} saved. Generate a new allocation when your details are ready.`);
  }

  function deleteEntity() {
    const formData = new FormData(byId("edit-form"));
    const id = String(formData.get("entityId"));
    if (formData.get("entityType") === "room") state.rooms = state.rooms.filter(room => room.id !== id);
    else state.classes = state.classes.filter(item => item.id !== id);
    invalidateAllocation();
    saveState();
    renderAll();
    closeDialog();
    showToast("Details deleted. Generate the allocation again after updating your requirements.");
  }

  function allocate() {
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
    state.assignments = RoomAllocator.optimize(state.classes, state.rooms);
    renderRooms();
    renderAllocation();
    setView("allocation");
    const placed = Object.keys(state.assignments).length;
    showToast(`${placed} of ${state.classes.length} needed classes allocated.`);
  }

  function createId(prefix) {
    return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
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

  renderAll();
})();
