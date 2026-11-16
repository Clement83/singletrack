ALTER TABLE `trail_segment` ADD `zone` text;--> statement-breakpoint
CREATE INDEX `trail_segment_zone_idx` ON `trail_segment` (`zone`);--> statement-breakpoint
-- Les singles existants viennent tous du Var (zone 83).
UPDATE `trail_segment` SET `zone` = '83' WHERE `zone` IS NULL;
--> statement-breakpoint
-- Index spatial R-tree (#1428) : recherche par bbox en O(log n) sur des centaines de milliers de segments.
-- Clé = rowid de trail_segment ; maintenu par triggers (insert / update de bbox / delete).
CREATE VIRTUAL TABLE `trail_segment_rtree` USING rtree(id, min_lon, max_lon, min_lat, max_lat);
--> statement-breakpoint
INSERT INTO `trail_segment_rtree` (id, min_lon, max_lon, min_lat, max_lat) SELECT rowid, bbox_min_lon, bbox_max_lon, bbox_min_lat, bbox_max_lat FROM `trail_segment`;
--> statement-breakpoint
CREATE TRIGGER `trail_segment_rtree_ai` AFTER INSERT ON `trail_segment` BEGIN
  INSERT INTO `trail_segment_rtree` (id, min_lon, max_lon, min_lat, max_lat) VALUES (new.rowid, new.bbox_min_lon, new.bbox_max_lon, new.bbox_min_lat, new.bbox_max_lat);
END;
--> statement-breakpoint
CREATE TRIGGER `trail_segment_rtree_au` AFTER UPDATE ON `trail_segment` BEGIN
  DELETE FROM `trail_segment_rtree` WHERE id = old.rowid;
  INSERT INTO `trail_segment_rtree` (id, min_lon, max_lon, min_lat, max_lat) VALUES (new.rowid, new.bbox_min_lon, new.bbox_max_lon, new.bbox_min_lat, new.bbox_max_lat);
END;
--> statement-breakpoint
CREATE TRIGGER `trail_segment_rtree_ad` AFTER DELETE ON `trail_segment` BEGIN
  DELETE FROM `trail_segment_rtree` WHERE id = old.rowid;
END;
