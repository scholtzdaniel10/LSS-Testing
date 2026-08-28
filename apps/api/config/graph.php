<?php

return [

    /*
    |--------------------------------------------------------------------------
    | Overview aggregation cap
    |--------------------------------------------------------------------------
    |
    | Hard maximum for GET /projects/{project}/graph/overview?limit=. The
    | query param is a fileCap (hugeGraphOverviewKeep), not a total node
    | ceiling — folder hubs and error files are always kept, so the payload
    | may contain more nodes than this value.
    |
    */

    'aggregate_max_nodes' => (int) env('GRAPH_AGGREGATE_MAX_NODES', 200),

];
