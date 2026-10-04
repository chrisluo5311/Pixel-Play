local function report()
  local pos = mp.get_property_number("time-pos")
  local dur = mp.get_property_number("duration")
  local title = mp.get_property("media-title") or ""
  if pos then
    io.stdout:write(string.format("@@pos|%.1f|%.1f|%s\n", pos, dur or -1, title))
    io.stdout:flush()
  end
end
mp.add_periodic_timer(1, report)
mp.register_event("file-loaded", report)
