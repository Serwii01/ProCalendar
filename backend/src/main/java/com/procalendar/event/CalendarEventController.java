package com.procalendar.event;

import com.procalendar.sync.icloud.ICloudCalDavSyncService;
import com.procalendar.todo.Todo;
import com.procalendar.todo.TodoRepository;
import jakarta.validation.Valid;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

import java.time.LocalDateTime;
import java.util.List;

@RestController
@RequestMapping("/api/events")
@CrossOrigin(origins = "*")
public class CalendarEventController {

    private final CalendarEventRepository repository;
    private final ICloudCalDavSyncService icloud;
    private final TodoRepository todoRepo;

    public CalendarEventController(CalendarEventRepository repository,
                                   ICloudCalDavSyncService icloud,
                                   TodoRepository todoRepo) {
        this.repository = repository;
        this.icloud = icloud;
        this.todoRepo = todoRepo;
    }

    /** Crea una tarea (Todo) a partir de un evento existente. */
    @PostMapping("/{id}/to-todo")
    public Todo convertToTodo(@PathVariable Long id) {
        CalendarEvent ev = repository.findById(id)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Event not found"));
        Todo t = new Todo();
        t.setTitle(ev.getTitle());
        t.setNotes(ev.getDescription());
        t.setDueAt(ev.getStartAt());
        t.setPriority(Todo.Priority.MEDIUM);
        return todoRepo.save(t);
    }

    /**
     * Lists events.
     * - If from/to provided, returns events overlapping that range.
     * - If q provided, performs a text search.
     * - Otherwise returns everything (capped server-side for safety).
     */
    @GetMapping
    public List<CalendarEvent> list(
            @RequestParam(required = false)
            @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) LocalDateTime from,
            @RequestParam(required = false)
            @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) LocalDateTime to,
            @RequestParam(required = false) String q) {

        if (q != null && !q.isBlank()) {
            return repository.search(q.trim());
        }
        if (from != null && to != null) {
            return repository.findInRange(from, to);
        }
        return repository.findAll();
    }

    @GetMapping("/{id}")
    public CalendarEvent one(@PathVariable Long id) {
        return repository.findById(id)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Event not found"));
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public CalendarEvent create(@Valid @RequestBody CalendarEvent event) {
        event.setId(null);
        normalize(event);
        event.setDirty(true);   // marked for push on next sync
        return repository.save(event);
    }

    @PutMapping("/{id}")
    public CalendarEvent update(@PathVariable Long id, @Valid @RequestBody CalendarEvent payload) {
        CalendarEvent existing = repository.findById(id)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Event not found"));

        existing.setTitle(payload.getTitle());
        existing.setDescription(payload.getDescription());
        existing.setLocation(payload.getLocation());
        existing.setStartAt(payload.getStartAt());
        existing.setEndAt(payload.getEndAt());
        existing.setAllDay(payload.isAllDay());
        existing.setColor(payload.getColor());
        // Allow the user to assign / move events between iCloud calendars before sync.
        if (payload.getExternalCalendarId() != null) existing.setExternalCalendarId(payload.getExternalCalendarId());
        if (payload.getCalendarName()       != null) existing.setCalendarName(payload.getCalendarName());
        // Source/externalId/externalResourceUrl are only touched by sync flows.
        normalize(existing);
        existing.setDirty(true);   // local edit → needs push on next sync
        return repository.save(existing);
    }

    /**
     * Borra el evento local. Si cascade=true y el evento procede de iCloud,
     * también se borra el .ics remoto antes de la eliminación local.
     */
    @DeleteMapping("/{id}")
    public ResponseEntity<?> delete(@PathVariable Long id,
                                    @RequestParam(defaultValue = "false") boolean cascade) {
        CalendarEvent ev = repository.findById(id).orElse(null);
        if (ev == null) return ResponseEntity.notFound().build();

        boolean remoteDeleted = false;
        if (cascade && ev.getSource() == CalendarEvent.Source.ICLOUD) {
            remoteDeleted = icloud.deleteRemote(ev);
            if (!remoteDeleted) {
                return ResponseEntity.status(HttpStatus.BAD_GATEWAY)
                        .body("No se pudo borrar de iCloud (revisa logs). El evento NO se ha borrado local.");
            }
        }
        repository.deleteById(id);
        return ResponseEntity.ok().body(java.util.Map.of("deleted", true, "remoteDeleted", remoteDeleted));
    }

    private void normalize(CalendarEvent e) {
        if (e.getStartAt() == null) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "startAt is required");
        }
        if (e.getEndAt() == null) {
            // For all-day events, default end to same day end-of-day; for timed, default +1h
            e.setEndAt(e.isAllDay()
                    ? e.getStartAt().withHour(23).withMinute(59)
                    : e.getStartAt().plusHours(1));
        }
        if (e.getEndAt().isBefore(e.getStartAt())) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "endAt must be after startAt");
        }
        if (e.getSource() == null) {
            e.setSource(CalendarEvent.Source.LOCAL);
        }
    }
}
