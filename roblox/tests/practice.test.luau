--!strict
local InputState = require("../src/InputState")
local Practice = require("../src/Practice")

local held = InputState.new()
local first = {}
assert(held.begin(first, 1))
assert(not held.begin(first, 2))
assert(held.begin("D", 1))
for lane = 2, 4 do
	assert(held.begin(lane, lane))
end
assert(held.peak() == 4)
held.finish(first)
assert(held.held(1))
held.finish("D")
held.finish("D")
assert(not held.held(1))
held.clear(false)
assert(not held.held(4) and held.peak() == 4)
held.clear(true)
assert(held.peak() == 0)
assert(held.begin(first, 4))

local notes = Practice.new()
assert(Practice.press(notes, 1, 1.86, "FNF") == nil)
assert(Practice.press(notes, 1, 1.86, "mania") == "MISS")
notes = Practice.new()
assert(Practice.press(notes, 1, 1.2, "FNF") == nil)
assert(Practice.press(notes, 1, 2, "FNF") == "PERFECT")
assert(Practice.press(notes, 1, 2, "FNF") == nil)
assert(Practice.expire(notes, 3.1))
assert(not Practice.expire(notes, 3.1))
for lane = 1, 4 do
	assert(Practice.press(notes, lane, 7, "mania") == "PERFECT")
end
print("Input state and practice judgement passed")
