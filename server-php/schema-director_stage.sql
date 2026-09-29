-- ============================================================================
-- 3D 导演台 · 数据库迁移 · v0.3
-- 复用了 ai_video 同库 (ai_video) · utf8mb4_unicode_ci
--
-- 部署：
--   phpMyAdmin：直接复制粘贴到 SQL 编辑器 → 执行
--   命令行：  mysql -u ai_video -p ai_video < schema-director_stage.sql
--
-- 与 packages/scene-schema v0.1 的 JSON 字段严格对齐
--
-- v0.3 变更：JSON 类型 → LONGTEXT（兼容 phpMyAdmin 多语句解析）
--           PHP 端用 json_decode() 读 · 效果完全等价
-- ============================================================================

USE `ai_video`;

-- 1. director_stage_scene · 场景表
CREATE TABLE IF NOT EXISTS `director_stage_scene` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `owner_id` INT UNSIGNED NOT NULL,
  `title` VARCHAR(191) NOT NULL DEFAULT '',
  `schema_version` VARCHAR(16) NOT NULL DEFAULT '0.1',
  `scene_json` MEDIUMTEXT NOT NULL,
  `preset` VARCHAR(64) NOT NULL DEFAULT 'room_small',
  `aspect` VARCHAR(16) NOT NULL DEFAULT '2.39:1',
  `duration` DECIMAL(6,2) NOT NULL DEFAULT 5.00,
  `actor_count` TINYINT UNSIGNED NOT NULL DEFAULT 0,
  `status` VARCHAR(16) NOT NULL DEFAULT 'draft',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_ds_scene_owner` (`owner_id`, `updated_at`),
  KEY `idx_ds_scene_status` (`status`, `updated_at`),
  KEY `idx_ds_scene_preset` (`preset`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. director_stage_render_job · 视频模型渲染任务队列表
CREATE TABLE IF NOT EXISTS `director_stage_render_job` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `scene_id` INT UNSIGNED NOT NULL,
  `owner_id` INT UNSIGNED NOT NULL,
  `video_model` VARCHAR(64) NOT NULL DEFAULT 'kling',
  `video_provider` VARCHAR(64) NOT NULL DEFAULT '',
  `video_model_id` VARCHAR(191) NOT NULL DEFAULT '',
  `reference_video_path` VARCHAR(512) NOT NULL DEFAULT '',
  `prompt` MEDIUMTEXT NULL,
  `negative_prompt` MEDIUMTEXT NULL,
  `status` VARCHAR(16) NOT NULL DEFAULT 'queued',
  `result_video_url` VARCHAR(512) NULL,
  `result_meta_json` LONGTEXT NULL,
  `error_message` VARCHAR(1024) NULL,
  `started_at` DATETIME NULL,
  `finished_at` DATETIME NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_ds_job_scene` (`scene_id`, `created_at`),
  KEY `idx_ds_job_owner` (`owner_id`, `status`, `created_at`),
  KEY `idx_ds_job_status` (`status`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. director_stage_selfcheck · 多模态审片历史
CREATE TABLE IF NOT EXISTS `director_stage_selfcheck` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `scene_id` INT UNSIGNED NOT NULL,
  `render_job_id` INT UNSIGNED NULL,
  `owner_id` INT UNSIGNED NOT NULL,
  `first_frame_path` VARCHAR(512) NOT NULL DEFAULT '',
  `check_result` VARCHAR(16) NOT NULL DEFAULT '',
  `check_json` LONGTEXT NULL,
  `llm_provider` VARCHAR(64) NOT NULL DEFAULT '',
  `llm_model_id` VARCHAR(191) NOT NULL DEFAULT '',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_ds_selfcheck_scene` (`scene_id`, `created_at`),
  KEY `idx_ds_selfcheck_result` (`check_result`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 4. schema_meta 版本记录
INSERT INTO `schema_meta` (`name`, `version`) VALUES ('director_stage', 1)
ON DUPLICATE KEY UPDATE `version` = GREATEST(`version`, VALUES(`version`));