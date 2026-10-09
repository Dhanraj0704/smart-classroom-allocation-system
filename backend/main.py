
from fastapi import FastAPI
from pydantic import BaseModel

app = FastAPI(title="Smart Classroom Allocation System")

# Sample classroom data
classrooms = [
    {"id": 1, "name": "Room A", "capacity": 60, "available": True},
    {"id": 2, "name": "Room B", "capacity": 30, "available": True},
    {"id": 3, "name": "Room C", "capacity": 100, "available": False},
]


class AllocationRequest(BaseModel):
    students: int


@app.get("/")
def home():
    return {"message": "Smart Classroom Allocation System API is running"}


@app.get("/classrooms")
def get_classrooms():
    return classrooms


@app.post("/allocate")
def allocate_classroom(request: AllocationRequest):
    if request.students <= 0:
        return {"message": "Enter a valid student count"}

    suitable_rooms = [
        room for room in classrooms
        if room["available"] and room["capacity"] >= request.students
    ]

    if not suitable_rooms:
        return {"message": "No suitable classroom available"}

    room = min(suitable_rooms, key=lambda r: r["capacity"])

    return {
        "message": "Classroom allocated successfully",
        "classroom": room
    }