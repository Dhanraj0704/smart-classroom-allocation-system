# Roomwise classroom allocation

Open `index.html` in a browser. The app needs no server, build step, or package installation.

## Workflow

1. **Available Classrooms:** save each room number, block/building, seat capacity, available facilities (projector, smart board, lab PCs, or recording), and timetable slots when the room is available.
2. **Needed Classes:** enter each class number, subject, student count, meeting day/time, required facilities, and optional preferred block.
3. **Class Allocation:** generate and review the room plan. A room is assigned only when it is large enough, has all required facilities, and is available at that class's time. The same room is never assigned to two classes in the same slot.

Within these requirements, the allocator maximizes the number of classes placed, favors rooms with less unused capacity, and honors a preferred block when possible. Unmatched classes show why no room was suitable.

Classroom and class details are saved in the browser's local storage and remain on that device. The app opens with an empty inventory so you can enter your college's own room and class details. Existing saved Roomwise data is preserved and adapted to the current room-number/block form.
