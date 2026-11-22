--!strict
local Practice = {}
local hitWindow = 0.15
Practice.travelTime = 1.2

local chart = {
	{2, 1}, {2.5, 2}, {3, 3}, {3.5, 4},
	{4.5, 1}, {4.5, 4}, {5.5, 2}, {5.5, 3},
	{7, 1}, {7, 2}, {7, 3}, {7, 4},
	{8.5, 1}, {8.5, 2}, {8.5, 3}, {8.5, 4},
}
Practice.duration = 9.5

type Note = {time: number, lane: number, resolved: boolean}
type Notes = {Note}

function Practice.new(): Notes
	local notes: Notes = {}
	for _, entry in chart do
		table.insert(notes, {time = entry[1], lane = entry[2], resolved = false})
	end
	return notes
end

function Practice.expire(notes: Notes, now: number): boolean
	local missed = false
	for _, note in notes do
		if not note.resolved and now > note.time + hitWindow then
			note.resolved = true
			missed = true
		end
	end
	return missed
end

function Practice.press(notes: Notes, lane: number, now: number, mode: string): string?
	local nearest: Note? = nil
	local best = math.huge
	for _, note in notes do
		local distance = math.abs(note.time - now)
		local earlyGhost = mode == "FNF" and now < note.time - 0.12
		if not earlyGhost and not note.resolved and note.lane == lane and distance <= hitWindow and distance < best then
			nearest = note
			best = distance
		end
	end
	if nearest then
		nearest.resolved = true
		if best <= 0.045 then
			return "PERFECT"
		elseif best <= 0.09 then
			return "GREAT"
		end
		return if best <= 0.12 then "GOOD" else "MISS"
	end
	if mode == "mania" then
		return "MISS"
	end
	return nil
end

return Practice
