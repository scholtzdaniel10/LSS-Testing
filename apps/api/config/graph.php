<?php

return [

    /*
    |--------------------------------------------------------------------------
    | Overview aggregation cap
    |--------------------------------------------------------------------------
    |
    | Hard maximum for GET /projects/{project}/graph/overview?limit= (fileCap),
    | GET /graph/rollup folder count, and GET /graph/neighbourhood node count.
    | Overview may still return more nodes than this value because folder hubs
    | and error files are always kept. Rollup never fills leftover slots with
    | files. Neighbourhood always keeps the focus roots, then ranks the rest.
    |
    */

    'aggregate_max_nodes' => (int) env('GRAPH_AGGREGATE_MAX_NODES', 200),

];
