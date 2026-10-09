(function (root) {
  const PERIODS = [
    { id: "P1", label: "09:00 – 10:30" },
    { id: "P2", label: "10:45 – 12:15" },
    { id: "P3", label: "13:00 – 14:30" },
    { id: "P4", label: "14:45 – 16:15" },
    { id: "P5", label: "16:30 – 18:00" }
  ];
  const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];

  function slotKey(day, period) {
    return `${day}|${period}`;
  }

  function isEligible(classItem, room) {
    return room.capacity >= classItem.enrollment &&
      classItem.facilities.every(facility => room.facilities.includes(facility)) &&
      room.availableSlots.includes(slotKey(classItem.day, classItem.period));
  }

  function edgeCost(classItem, room) {
    const seatWaste = (room.capacity - classItem.enrollment) / room.capacity;
    const preferredBlock = classItem.preferredBlock || classItem.preferredBuilding;
    const roomBlock = room.block || room.building;
    const locationPenalty = preferredBlock && preferredBlock !== roomBlock ? 18 : 0;
    return Math.round(seatWaste * 64 + locationPenalty);
  }

  function addEdge(graph, from, to, capacity, cost) {
    const forward = { to, reverse: graph[to].length, capacity, cost };
    const reverse = { to: from, reverse: graph[from].length, capacity: 0, cost: -cost };
    graph[from].push(forward);
    graph[to].push(reverse);
    return forward;
  }

  function optimize(classes, rooms) {
    const assignments = {};
    const slots = [...new Set(classes.map(item => slotKey(item.day, item.period)))];

    for (const slot of slots) {
      const slotClasses = classes.filter(item => slotKey(item.day, item.period) === slot);
      const slotRooms = rooms.filter(room => room.availableSlots.includes(slot));
      const source = 0;
      const firstClass = 1;
      const firstRoom = firstClass + slotClasses.length;
      const sink = firstRoom + slotRooms.length;
      const graph = Array.from({ length: sink + 1 }, () => []);
      const assignmentEdges = [];

      slotClasses.forEach((classItem, classIndex) => {
        const classNode = firstClass + classIndex;
        addEdge(graph, source, classNode, 1, 0);
        slotRooms.forEach((room, roomIndex) => {
          if (isEligible(classItem, room)) {
            const edge = addEdge(graph, classNode, firstRoom + roomIndex, 1, edgeCost(classItem, room));
            assignmentEdges.push({ classId: classItem.id, roomId: room.id, edge });
          }
        });
      });
      slotRooms.forEach((_, index) => addEdge(graph, firstRoom + index, sink, 1, 0));

      let totalCost = 0;
      while (true) {
        const distances = Array(graph.length).fill(Infinity);
        const previousNode = Array(graph.length).fill(-1);
        const previousEdge = Array(graph.length).fill(-1);
        const inQueue = Array(graph.length).fill(false);
        const queue = [source];
        distances[source] = 0;
        inQueue[source] = true;

        for (let head = 0; head < queue.length; head += 1) {
          const node = queue[head];
          inQueue[node] = false;
          graph[node].forEach((edge, edgeIndex) => {
            const distance = distances[node] + edge.cost;
            if (edge.capacity > 0 && distance < distances[edge.to]) {
              distances[edge.to] = distance;
              previousNode[edge.to] = node;
              previousEdge[edge.to] = edgeIndex;
              if (!inQueue[edge.to]) {
                queue.push(edge.to);
                inQueue[edge.to] = true;
              }
            }
          });
        }

        if (!Number.isFinite(distances[sink])) break;
        totalCost += distances[sink];
        for (let node = sink; node !== source; node = previousNode[node]) {
          const edge = graph[previousNode[node]][previousEdge[node]];
          edge.capacity -= 1;
          graph[node][edge.reverse].capacity += 1;
        }
      }

      assignmentEdges.forEach(({ classId, roomId, edge }) => {
        if (edge.capacity === 0) assignments[classId] = roomId;
      });
      void totalCost;
    }
    return assignments;
  }

  const api = { DAYS, PERIODS, slotKey, isEligible, optimize };
  // Shared by the browser (window.RoomAllocator) and the Node server (require).
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.RoomAllocator = api;
})(typeof window !== "undefined" ? window : globalThis);
