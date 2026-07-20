<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * PLT-12 — the deltas from vault note "11 DB Handover — Postgres Schema &
 * Performance": jsonb conversions and pattern-ops (Postgres-only, guarded),
 * the hot-query indexes, uniqueness constraints, and the job_statuses table
 * backing the PLT-7 queued-job status pattern. SQLite must stay green: every
 * driver-specific statement is guarded.
 */
return new class extends Migration
{
    /** @var array<string, string[]> document columns to convert to jsonb */
    private array $jsonbColumns = [
        'graph_snapshots' => ['edges'],
        'usage_reports' => ['report'],
        'errors' => ['range', 'upstream', 'downstream'],
        'health_snapshots' => ['snapshot'],
    ];

    public function up(): void
    {
        Schema::create('job_statuses', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->string('type', 64);
            $table->foreignUuid('project_id')->nullable()->constrained('projects')->cascadeOnDelete();
            $table->string('status', 16)->default('queued');
            $table->unsignedTinyInteger('progress')->default(0);
            $table->text('message')->nullable();
            $table->timestamps();

            $table->index(['project_id', 'created_at']);
        });

        Schema::table('projects', function (Blueprint $table) {
            $table->unique('name');
        });

        Schema::table('project_files', function (Blueprint $table) {
            $table->index(['project_id', 'lang']);
        });

        Schema::table('graph_snapshots', function (Blueprint $table) {
            $table->index(['project_id', 'scanned_at']);
        });

        Schema::table('usage_reports', function (Blueprint $table) {
            $table->index(['project_id', 'created_at']);
        });

        Schema::table('scans', function (Blueprint $table) {
            $table->unique(['project_id', 'scan_hash']);
            $table->index(['project_id', 'created_at']);
        });

        Schema::table('errors', function (Blueprint $table) {
            $table->index(['scan_id', 'severity']);
            $table->index(['scan_id', 'kind']);
            $table->index(['scan_id', 'file']);
        });

        Schema::table('health_snapshots', function (Blueprint $table) {
            $table->index(['project_id', 'taken_at']);
        });

        Schema::table('target_environments', function (Blueprint $table) {
            $table->unique(['project_id', 'name']);
        });

        if (DB::connection()->getDriverName() === 'pgsql') {
            foreach ($this->jsonbColumns as $tableName => $columns) {
                foreach ($columns as $column) {
                    DB::statement(
                        "ALTER TABLE {$tableName} ALTER COLUMN {$column} TYPE jsonb USING {$column}::jsonb"
                    );
                }
            }

            // Folder-prefix tree queries: WHERE path LIKE 'app/%'.
            DB::statement(
                'CREATE INDEX project_files_path_prefix_idx ON project_files (project_id, path text_pattern_ops)'
            );
        }
    }

    public function down(): void
    {
        if (DB::connection()->getDriverName() === 'pgsql') {
            DB::statement('DROP INDEX IF EXISTS project_files_path_prefix_idx');

            foreach ($this->jsonbColumns as $tableName => $columns) {
                foreach ($columns as $column) {
                    DB::statement(
                        "ALTER TABLE {$tableName} ALTER COLUMN {$column} TYPE json USING {$column}::json"
                    );
                }
            }
        }

        Schema::table('target_environments', function (Blueprint $table) {
            $table->dropUnique(['project_id', 'name']);
        });

        Schema::table('health_snapshots', function (Blueprint $table) {
            $table->dropIndex(['project_id', 'taken_at']);
        });

        Schema::table('errors', function (Blueprint $table) {
            $table->dropIndex(['scan_id', 'severity']);
            $table->dropIndex(['scan_id', 'kind']);
            $table->dropIndex(['scan_id', 'file']);
        });

        Schema::table('scans', function (Blueprint $table) {
            $table->dropUnique(['project_id', 'scan_hash']);
            $table->dropIndex(['project_id', 'created_at']);
        });

        Schema::table('usage_reports', function (Blueprint $table) {
            $table->dropIndex(['project_id', 'created_at']);
        });

        Schema::table('graph_snapshots', function (Blueprint $table) {
            $table->dropIndex(['project_id', 'scanned_at']);
        });

        Schema::table('project_files', function (Blueprint $table) {
            $table->dropIndex(['project_id', 'lang']);
        });

        Schema::table('projects', function (Blueprint $table) {
            $table->dropUnique(['name']);
        });

        Schema::dropIfExists('job_statuses');
    }
};
