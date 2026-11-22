local Players = game:GetService("Players")
local RunService = game:GetService("RunService")
local Input = game:GetService("UserInputService")
local GuiService = game:GetService("GuiService")

local InputState = require(script.Parent.InputState)
local Practice = require(script.Parent.Practice)
local View = require(script.Parent.View)

local lanes, modeButton, startButton, status = View.create(Players.LocalPlayer:WaitForChild("PlayerGui"))
local keys = {[Enum.KeyCode.D] = 1, [Enum.KeyCode.F] = 2, [Enum.KeyCode.J] = 3, [Enum.KeyCode.K] = 4}
local held = InputState.new()
local mode = "FNF"
local startedAt = nil
local notes = {}
local sprites = {}
local result = "Tap the lanes or start the chart"
local menuOpen = false

local function redrawInput()
	for lane, area in lanes do
		area.BackgroundColor3 = View.laneColor(held.held(lane), lane)
	end
	local caption = string.format("4K PEAK %d/4  |  %s", held.peak(), result)
	if status.Text ~= caption then
		status.Text = caption
	end
end

local function clearChart()
	startedAt = nil
	for _, sprite in sprites do
		sprite:Destroy()
	end
	table.clear(sprites)
	table.clear(notes)
end

local function press(source, lane)
	if menuOpen or not held.begin(source, lane) then
		return
	end
	if startedAt then
		local now = os.clock() - startedAt
		if Practice.expire(notes, now) then
			result = "MISS"
		end
		result = Practice.press(notes, lane, now, mode) or result
	end
	redrawInput()
end

for lane, area in lanes do
	area.InputBegan:Connect(function(input)
		if input.UserInputType == Enum.UserInputType.Touch then
			press(input, lane)
			-- Also cover a cancelled touch that never reaches global InputEnded.
			local connection
			connection = input:GetPropertyChangedSignal("UserInputState"):Connect(function()
				if input.UserInputState == Enum.UserInputState.Cancel or input.UserInputState == Enum.UserInputState.End then
					connection:Disconnect()
					held.finish(input)
					redrawInput()
				end
			end)
		end
	end)
end

Input.InputBegan:Connect(function(input, processed)
	local lane = keys[input.KeyCode]
	if not processed and input.UserInputType == Enum.UserInputType.Keyboard and lane then
		press(input.KeyCode, lane)
	end
end)

Input.InputEnded:Connect(function(input)
	if input.UserInputType == Enum.UserInputType.Touch then
		held.finish(input)
	elseif input.UserInputType == Enum.UserInputType.Keyboard then
		held.finish(input.KeyCode)
	end
	redrawInput()
end)

local function interrupt()
	held.clear(false)
	if startedAt then
		clearChart()
		result = "Interrupted — tap RETRY"
	end
	redrawInput()
end

Input.WindowFocusReleased:Connect(interrupt)
GuiService.MenuOpened:Connect(function()
	menuOpen = true
	interrupt()
end)
GuiService.MenuClosed:Connect(function()
	menuOpen = false
end)

modeButton.Activated:Connect(function()
	mode = if mode == "FNF" then "mania" else "FNF"
	modeButton.Text = mode
	interrupt()
end)

startButton.Activated:Connect(function()
	clearChart()
	held.clear(true)
	notes = Practice.new()
	for index, note in notes do
		sprites[index] = View.createNote(lanes[note.lane])
	end
	result = "Ready"
	startedAt = os.clock()
	redrawInput()
end)

RunService.PreRender:Connect(function()
	if not startedAt then
		return
	end
	local now = os.clock() - startedAt
	if now >= Practice.duration then
		clearChart()
		result = "Complete — tap RETRY"
		redrawInput()
		return
	end
	if Practice.expire(notes, now) then
		result = "MISS"
		redrawInput()
	end
	for index, note in notes do
		local sprite = sprites[index]
		local y = View.line + (now - note.time) * View.line / Practice.travelTime
		sprite.Visible = not note.resolved and y >= 0
		if sprite.Visible then
			sprite.Position = UDim2.fromScale(0.5, y)
		end
	end
end)

redrawInput()
