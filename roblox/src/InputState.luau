--!strict
local InputState = {}

function InputState.new()
	local sources: {[any]: number} = {}
	local counts = {0, 0, 0, 0}
	local total = 0
	local peak = 0

	return {
		begin = function(source: any, lane: number): boolean
			if sources[source] then
				return false
			end
			sources[source] = lane
			counts[lane] += 1
			if counts[lane] == 1 then
				total += 1
				peak = math.max(peak, total)
			end
			return true
		end,
		finish = function(source: any)
			local lane = sources[source]
			if lane then
				sources[source] = nil
				counts[lane] -= 1
				if counts[lane] == 0 then
					total -= 1
				end
			end
		end,
		clear = function(resetPeak: boolean)
			table.clear(sources)
			for lane = 1, 4 do
				counts[lane] = 0
			end
			total = 0
			if resetPeak then
				peak = 0
			end
		end,
		held = function(lane: number): boolean
			return counts[lane] > 0
		end,
		peak = function(): number
			return peak
		end,
	}
end

return InputState
