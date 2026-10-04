local function report()
  local pos = mp.get_property_number("time-pos")
  local dur = mp.get_property_number("duration")
  local paused = mp.get_property_bool("pause") and 1 or 0
  local title = mp.get_property("media-title") or ""
  if pos then
    io.stdout:write(string.format("@@pos|%.1f|%.1f|%d|%s\n", pos, dur or -1, paused, title))
    io.stdout:flush()
  end
end
mp.add_periodic_timer(1, report)
mp.register_event("file-loaded", report)
-- Report a pause or resume at once, not on the next tick.
mp.observe_property("pause", "bool", report)
