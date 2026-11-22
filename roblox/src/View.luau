local View = {}
View.line = 0.5

local function label(parent, caption, position, size, button)
	local object = Instance.new(button and "TextButton" or "TextLabel")
	object.Position = position
	object.Size = size
	object.Text = caption
	object.Font = Enum.Font.GothamBold
	object.TextColor3 = Color3.fromRGB(239, 246, 255)
	object.TextScaled = true
	object.BackgroundColor3 = Color3.fromRGB(27, 43, 68)
	object.BackgroundTransparency = button and 0 or 1
	object.ZIndex = 5
	object.Parent = parent
	local limit = Instance.new("UITextSizeConstraint")
	limit.MaxTextSize = 20
	limit.Parent = object
	return object
end

function View.create(playerGui)
	local gui = Instance.new("ScreenGui")
	gui.Name = "PulseLanePractice"
	gui.ResetOnSpawn = false
	gui.DisplayOrder = 10
	gui.ScreenInsets = Enum.ScreenInsets.CoreUISafeInsets

	local background = Instance.new("Frame")
	background.Size = UDim2.fromScale(1, 1)
	background.BackgroundColor3 = Color3.fromRGB(10, 16, 28)
	background.Parent = gui

	local field = Instance.new("Frame")
	field.AnchorPoint = Vector2.new(0.5, 0)
	field.Position = UDim2.fromScale(0.5, 0.17)
	field.Size = UDim2.fromScale(0.96, 0.8)
	field.BackgroundTransparency = 1
	field.ClipsDescendants = true
	field.Parent = background
	local limit = Instance.new("UISizeConstraint")
	limit.MaxSize = Vector2.new(640, math.huge)
	limit.Parent = field

	local lanes = {}
	for lane, key in {"D", "F", "J", "K"} do
		local area = Instance.new("Frame")
		area.Name = "Lane" .. lane
		area.Position = UDim2.fromScale((lane - 1) / 4, 0)
		area.Size = UDim2.new(0.25, -2, 1, 0)
		area.BackgroundColor3 = View.laneColor(false)
		area.BorderSizePixel = 0
		area.Active = true
		area.Parent = field
		label(area, key, UDim2.fromScale(0, 0.86), UDim2.fromScale(1, 0.11), false).Interactable = false
		lanes[lane] = area
	end

	local line = Instance.new("Frame")
	line.AnchorPoint = Vector2.new(0, 0.5)
	line.Position = UDim2.fromScale(0, View.line)
	line.Size = UDim2.new(1, 0, 0, 3)
	line.BackgroundColor3 = Color3.fromRGB(244, 249, 255)
	line.BorderSizePixel = 0
	line.ZIndex = 4
	line.Parent = field

	local mode = label(background, "FNF", UDim2.fromScale(0.03, 0.015), UDim2.fromScale(0.25, 0.08), true)
	local start = label(background, "START / RETRY", UDim2.fromScale(0.64, 0.015), UDim2.fromScale(0.33, 0.08), true)
	local result = label(background, "", UDim2.fromScale(0.03, 0.1), UDim2.fromScale(0.94, 0.06), false)
	gui.Parent = playerGui
	return lanes, mode, start, result
end

function View.laneColor(held)
	return held and Color3.fromRGB(36, 97, 143) or Color3.fromRGB(17, 31, 51)
end

function View.createNote(lane)
	local note = Instance.new("Frame")
	note.AnchorPoint = Vector2.new(0.5, 0.5)
	note.Size = UDim2.new(0.82, 0, 0, 12)
	note.BackgroundColor3 = Color3.fromRGB(114, 214, 255)
	note.BorderSizePixel = 0
	note.ZIndex = 3
	note.Visible = false
	note.Interactable = false
	note.Parent = lane
	return note
end

return View
