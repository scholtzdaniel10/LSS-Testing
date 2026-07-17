<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('projects', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->string('name');
            $table->string('sandbox_path')->nullable();
            $table->timestamp('last_imported_at')->nullable();
            $table->timestamps();
        });

        Schema::create('project_files', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('project_id')->constrained('projects')->cascadeOnDelete();
            $table->string('path');
            $table->unsignedBigInteger('size')->default(0);
            $table->string('lang', 32)->nullable();
            $table->timestamps();

            $table->unique(['project_id', 'path']);
        });

        Schema::create('graph_snapshots', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('project_id')->constrained('projects')->cascadeOnDelete();
            $table->timestamp('scanned_at');
            $table->json('edges');
            $table->timestamps();
        });

        Schema::create('usage_reports', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('project_id')->constrained('projects')->cascadeOnDelete();
            $table->json('report');
            $table->timestamps();
        });

        Schema::create('scans', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('project_id')->constrained('projects')->cascadeOnDelete();
            $table->string('scan_hash');
            $table->string('status');
            $table->timestamps();
        });

        Schema::create('errors', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('scan_id')->constrained('scans')->cascadeOnDelete();
            $table->string('source');
            $table->string('rule_id');
            $table->string('kind');
            $table->string('severity');
            $table->string('file');
            $table->json('range');
            $table->text('message');
            $table->text('explanation')->nullable();
            $table->json('upstream')->nullable();
            $table->json('downstream')->nullable();
            $table->timestamps();
        });

        Schema::create('health_snapshots', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('project_id')->constrained('projects')->cascadeOnDelete();
            $table->timestamp('taken_at');
            $table->json('snapshot');
            $table->timestamps();
        });

        Schema::create('target_environments', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('project_id')->constrained('projects')->cascadeOnDelete();
            $table->string('name');
            $table->string('base_url');
            $table->text('notes')->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('target_environments');
        Schema::dropIfExists('health_snapshots');
        Schema::dropIfExists('errors');
        Schema::dropIfExists('scans');
        Schema::dropIfExists('usage_reports');
        Schema::dropIfExists('graph_snapshots');
        Schema::dropIfExists('project_files');
        Schema::dropIfExists('projects');
    }
};
