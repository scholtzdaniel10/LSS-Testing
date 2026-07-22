<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;

/**
 * DSK-7: a user-consented directory root that may be linked as a local project.
 *
 * Deleting a root does NOT unlink already-linked projects — their
 * local_source_path is stored on the Project and remains readable.
 * The root list only gates new link-local requests.
 */
class LocalRoot extends Model
{
    use HasUuids;

    protected $fillable = ['path'];
}
