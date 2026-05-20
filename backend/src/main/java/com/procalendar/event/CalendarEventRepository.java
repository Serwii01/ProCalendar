package com.procalendar.event;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;

public interface CalendarEventRepository extends JpaRepository<CalendarEvent, Long> {

    @Query("""
            SELECT e FROM CalendarEvent e
            WHERE e.endAt >= :from AND e.startAt < :to
            ORDER BY e.startAt ASC
            """)
    List<CalendarEvent> findInRange(@Param("from") LocalDateTime from,
                                    @Param("to") LocalDateTime to);

    @Query("""
            SELECT e FROM CalendarEvent e
            WHERE LOWER(e.title) LIKE LOWER(CONCAT('%', :q, '%'))
               OR LOWER(COALESCE(e.description, '')) LIKE LOWER(CONCAT('%', :q, '%'))
               OR LOWER(COALESCE(e.location, '')) LIKE LOWER(CONCAT('%', :q, '%'))
            ORDER BY e.startAt ASC
            """)
    List<CalendarEvent> search(@Param("q") String query);

    Optional<CalendarEvent> findBySourceAndExternalId(CalendarEvent.Source source, String externalId);
}
