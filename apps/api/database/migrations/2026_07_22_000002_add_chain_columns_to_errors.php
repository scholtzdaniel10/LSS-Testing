<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * DX-8: errors on a shared dependency path are linked into a chain.
 * chain_id groups the members; is_root marks the most-upstream error(s).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('errors', function (Blueprint $table) {
            $table->uuid('chain_id')->nullable()->index();
            $table->boolean('is_root')->default(false);
        });
    }

    public function down(): void
    {
        Schema::table('errors', function (Blueprint $table) {
            $table->dropColumn(['chain_id', 'is_root']);
        });
    }
};
