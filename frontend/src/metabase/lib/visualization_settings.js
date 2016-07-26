import _  from "underscore";

import { getCardColors } from "metabase/visualizations/lib/utils";
import { getFriendlyName } from "metabase/visualizations/lib/utils";

import ChartSettingInput from "metabase/visualizations/components/settings/ChartSettingInput.jsx";
import ChartSettingInputNumeric from "metabase/visualizations/components/settings/ChartSettingInputNumeric.jsx";
import ChartSettingSelect from "metabase/visualizations/components/settings/ChartSettingSelect.jsx";
import ChartSettingToggle from "metabase/visualizations/components/settings/ChartSettingToggle.jsx";
import ChartSettingFieldPicker from "metabase/visualizations/components/settings/ChartSettingFieldPicker.jsx";
import ChartSettingColorsPicker from "metabase/visualizations/components/settings/ChartSettingColorsPicker.jsx";
import ChartSettingOrderedFields from "metabase/visualizations/components/settings/ChartSettingOrderedFields.jsx";

import { isNumeric, isMetric, isDimension, hasLatitudeAndLongitudeColumns } from "metabase/lib/schema_metadata";

function dimensionAndMetricsAreValid(dimension, metric, cols) {
    const colsByName = {};
    for (const col of cols) {
        colsByName[col.name] = col;
    }
    return (
        (dimension != null &&
            dimension.reduce((acc, name) =>
                acc && (name == undefined || (colsByName[name] && isDimension(colsByName[name])))
            , true)) &&
        (metric != null &&
            metric.reduce((acc, name) =>
                acc && (name == undefined || (colsByName[name] && isMetric(colsByName[name])))
            , true))
    );
}

import crossfilter from "crossfilter";

function getSeriesTitles([{ data: { rows, cols } }], vizSettings) {
    const seriesDimension = vizSettings["graph.dimensions"][1];
    if (seriesDimension != null) {
        let seriesIndex = _.findIndex(cols, (col) => col.name === seriesDimension);
        return crossfilter(rows).dimension(d => d[seriesIndex]).group().all().map(v => v.key);
    } else {
        return vizSettings["graph.metrics"].map(name => {
            let col = _.findWhere(cols, { name });
            return col && getFriendlyName(col);
        });
    }
}

import {
    getChartTypeFromData,
    DIMENSION_DIMENSION_METRIC,
    DIMENSION_METRIC,
    DIMENSION_METRIC_METRIC
} from "metabase/visualizations/lib/utils";

import { isDate } from "metabase/lib/schema_metadata";
import Query from "metabase/lib/query";

function getDefaultDimensionsAndMetrics([{ data: { cols, rows } }]) {
    let type = getChartTypeFromData(cols, rows, false);
    switch (type) {
        case DIMENSION_DIMENSION_METRIC:
            let dimensions = [cols[0], cols[1]];
            if (isDate(dimensions[1]) && !isDate(dimensions[0])) {
                // if the series dimension is a date but the axis dimension is not then swap them
                dimensions.reverse();
            } else if (dimensions[1].cardinality > dimensions[0].cardinality) {
                // if the series dimension is higher cardinality than the axis dimension then swap them
                dimensions.reverse();
            }
            return {
                dimensions: dimensions.map(col => col.name),
                metrics: [cols[2].name]
            };
        case DIMENSION_METRIC:
            return {
                dimensions: [cols[0].name],
                metrics: [cols[1].name]
            };
        case DIMENSION_METRIC_METRIC:
            return {
                dimensions: [cols[0].name],
                metrics: cols.slice(1).map(col => col.name)
            };
        default:
            const firstDimension = cols.filter(isDimension)[0].name;
            const firstMetric = cols.filter((col) => col.name !== firstDimension && isMetric(col))[0].name;
            return {
                dimensions: [firstDimension],
                metrics: [firstMetric]
            };
    }
}

function getOptionFromColumn(col) {
    return {
        name: getFriendlyName(col),
        value: col.name
    };
}

const SETTINGS = {
    "graph.dimensions": {
        section: "Data",
        title: "X-axis",
        widget: ChartSettingFieldPicker,
        getValue: (series, vizSettings) => {
            const [{ card, data }] = series;
            if (data && dimensionAndMetricsAreValid(
                card.visualization_settings["graph.dimensions"],
                card.visualization_settings["graph.metrics"],
                data.cols
            )) {
                return card.visualization_settings["graph.dimensions"];
            } else {
                return getDefaultDimensionsAndMetrics(series).dimensions;
            }
        },
        getProps: ([{ card, data }], vizSettings) => {
            const value = vizSettings["graph.dimensions"];
            const options = data.cols.filter(isDimension).map(getOptionFromColumn);
            return {
                options,
                addAnother: (options.length > value.length && value.length < 2) ? "Add a series breakout..." : null
            };
        },
        writeDependencies: ["graph.metrics"]
    },
    "graph.metrics": {
        section: "Data",
        title: "Y-axis",
        widget: ChartSettingFieldPicker,
        getValue: (series, vizSettings) => {
            const [{ card, data }] = series;
            if (data && dimensionAndMetricsAreValid(
                card.visualization_settings["graph.dimensions"],
                card.visualization_settings["graph.metrics"],
                data.cols
            )) {
                return card.visualization_settings["graph.metrics"];
            } else {
                return getDefaultDimensionsAndMetrics(series).metrics;
            }
        },
        getProps: ([{ card, data }], vizSettings) => {
            const value = vizSettings["graph.dimensions"];
            const options = data.cols.filter(isMetric).map(getOptionFromColumn);
            return {
                options,
                addAnother: options.length > value.length ? "Add another series..." : null
            };
        },
        writeDependencies: ["graph.dimensions"]
    },
    "line.interpolate": {
        section: "Display",
        title: "Style",
        widget: ChartSettingSelect,
        props: {
            options: [
                { name: "Line", value: "linear" },
                { name: "Curve", value: "cardinal" },
                { name: "Step", value: "step-after" },
            ]
        },
        getDefault: () => "linear"
    },
    "line.marker_enabled": {
        section: "Display",
        title: "Show point markers on lines",
        widget: ChartSettingToggle
    },
    "stackable.stacked": {
        section: "Display",
        title: "Stacked",
        widget: ChartSettingToggle,
        getDefault: ([{ card, data }], vizSettings) => (
            // area charts should usually be stacked
            card.display === "area" ||
            // legacy default for D-M-M+ charts
            (card.display === "area" && vizSettings["graph.metrics"].length > 1)
        )
    },
    "graph.colors": {
        section: "Display",
        widget: ChartSettingColorsPicker,
        readDependencies: ["graph.dimensions", "graph.metrics"],
        getDefault: ([{ card, data }], vizSettings) => {
            return getCardColors(card);
        },
        getProps: (series, vizSettings) => {
            return { seriesTitles: getSeriesTitles(series, vizSettings) };
        }
    },
    "graph.x_axis.axis_enabled": {
        section: "Axes",
        title: "Show x-axis line and marks",
        widget: ChartSettingToggle,
        default: true
    },
    "graph.y_axis.axis_enabled": {
        section: "Axes",
        title: "Show y-axis line and marks",
        widget: ChartSettingToggle,
        default: true
    },
    "graph.y_axis.auto_range": {
        section: "Axes",
        title: "Auto y-axis range",
        widget: ChartSettingToggle,
        default: true
    },
    "graph.y_axis.min": {
        section: "Axes",
        title: "Min",
        widget: ChartSettingInputNumeric,
        default: 0,
        getHidden: (series, vizSettings) => vizSettings["graph.y_axis.auto_range"] !== false
    },
    "graph.y_axis.max": {
        section: "Axes",
        title: "Min",
        widget: ChartSettingInputNumeric,
        default: 100,
        getHidden: (series, vizSettings) => vizSettings["graph.y_axis.auto_range"] !== false
    },
/*
    "graph.y_axis_right.auto_range": {
        section: "Axes",
        title: "Auto right-hand y-axis range",
        widget: ChartSettingToggle,
        default: true
    },
    "graph.y_axis_right.min": {
        section: "Axes",
        title: "Min",
        widget: ChartSettingInputNumeric,
        default: 0,
        getHidden: (series, vizSettings) => vizSettings["graph.y_axis_right.auto_range"] !== false
    },
    "graph.y_axis_right.max": {
        section: "Axes",
        title: "Min",
        widget: ChartSettingInputNumeric,
        default: 100,
        getHidden: (series, vizSettings) => vizSettings["graph.y_axis_right.auto_range"] !== false
    },
*/
    "graph.y_axis.auto_split": {
        section: "Axes",
        title: "Use a split y-axis when necessary",
        widget: ChartSettingToggle,
        default: true
    },
    "graph.x_axis.labels_enabled": {
        section: "Labels",
        title: "Show label on x-axis",
        widget: ChartSettingToggle,
        default: true
    },
    "graph.x_axis.title_text": {
        section: "Labels",
        title: "X-axis label",
        widget: ChartSettingInput,
        getHidden: (series, vizSettings) => vizSettings["graph.x_axis.labels_enabled"] === false
    },
    "graph.y_axis.labels_enabled": {
        section: "Labels",
        title: "Show label on y-axis",
        widget: ChartSettingToggle,
        default: true
    },
    "graph.y_axis.title_text": {
        section: "Labels",
        title: "Y-axis label",
        widget: ChartSettingInput,
        getHidden: (series, vizSettings) => vizSettings["graph.y_axis.labels_enabled"] === false
    },
    "pie.dimension": {
        section: "Data",
        title: "Measure",
        widget: ChartSettingFieldPicker
    },
    "pie.metric": {
        section: "Data",
        title: "Slice by",
        widget: ChartSettingFieldPicker
    },
    "pie.show_legend": {
        section: "Legend",
        title: "Show legend",
        widget: ChartSettingToggle
    },
    "pie.show_legend_perecent": {
        section: "Legend",
        title: "Show percentages in legend",
        widget: ChartSettingToggle,
        default: true
    },
    "scalar.separator": {
        title: "Separator",
        widget: ChartSettingSelect,
        props: {
            options: [
                { name: "None", value: "" },
                { name: "Comma", value: "," },
                { name: "Period", value: "." },
            ]
        },
        default: ","
    },
    "scalar.decimals": {
        title: "Number of decimal places",
        widget: ChartSettingInputNumeric
    },
    "scalar.prefix": {
        title: "Add a prefix",
        widget: ChartSettingInput
    },
    "scalar.suffix": {
        title: "Add a suffix",
        widget: ChartSettingInput
    },
    "scalar.scale": {
        title: "Multiply by a number",
        widget: ChartSettingInputNumeric
    },
    "table.pivot": {
        title: "Pivot the table",
        widget: ChartSettingToggle,
        getHidden: ([{ card, data }]) => (
            data && data.cols.length !== 3
        ),
        getDefault: ([{ card, data }]) => (
            (data && data.cols.length === 3) &&
            Query.isStructured(card.dataset_query) &&
            !Query.isBareRowsAggregation(card.dataset_query.query)
        )
    },
    "table.fields": {
        title: "Fields to include",
        widget: ChartSettingOrderedFields,
        getHidden: (series, vizSettings) => vizSettings["table.pivot"],
        getDefault: ([{ data: { cols }}]) => cols.map(col => ({
            name: col.name,
            enabled: true
        })),
        getProps: ([{ data: { cols }}]) => ({
            columnNames: cols.reduce((o, col) => ({ ...o, [col.name]: getFriendlyName(col)}), {})
        })
    },
    "map.type": {
        title: "Map type",
        widget: ChartSettingSelect,
        props: {
            options: [
                { name: "Pin map", value: "pin" },
                { name: "Region map", value: "region" }
            ]
        },
        getDefault: ([{ card, data: { cols } }]) => {
            switch (card.display) {
                case "state":
                case "country":
                    return "region";
                case "pin_map":
                    return "pin";
                default:
                    if (hasLatitudeAndLongitudeColumns(cols)) {
                        return "pin";
                    } else {
                        return "region";
                    }
            }
        }
    },
    "map.latitude_field": {
        title: "Latitude field",
        widget: ChartSettingSelect,
        getDefault: ([{ card, data: { cols }}]) =>
            (_.findWhere(cols, { special_type: "latitude" }) || {}).name,
        getProps: ([{ card, data: { cols }}]) => ({
            options: cols.filter(isNumeric).map(getOptionFromColumn)
        }),
        getHidden: (series, vizSettings) => vizSettings["map.type"] !== "pin"
    },
    "map.longitude_field": {
        title: "Longitude field",
        widget: ChartSettingSelect,
        getDefault: ([{ card, data: { cols }}]) =>
            (_.findWhere(cols, { special_type: "longitude" }) || {}).name,
        getProps: ([{ card, data: { cols }}]) => ({
            options: cols.filter(isNumeric).map(getOptionFromColumn)
        }),
        getHidden: (series, vizSettings) => vizSettings["map.type"] !== "pin"
    },
    "map.region": {
        title: "Region map",
        widget: ChartSettingSelect,
        getDefault: ([{ card, data: { cols }}]) => {
            switch (card.display) {
                case "country":
                    return "world_countries";
                case "state":
                default:
                    return "us_states";
            }
        },
        props: {
            options: [
                { name: "United States", value: "us_states" },
                { name: "World", value: "world_countries" },
            ]
        },
        getHidden: (series, vizSettings) => vizSettings["map.type"] !== "region"
    },
    "map.metric": {
        title: "Metric field",
        widget: ChartSettingSelect,
        getDefault: ([{ card, data: { cols }}]) =>
            (_.find(cols, isMetric) || {}).name,
        getProps: ([{ card, data: { cols }}]) => ({
            options: cols.filter(isMetric).map(getOptionFromColumn)
        }),
        getHidden: (series, vizSettings) => vizSettings["map.type"] !== "region"
    },
    "map.dimension": {
        title: "Region field",
        widget: ChartSettingSelect,
        getDefault: ([{ card, data: { cols }}]) =>
            (_.find(cols, isDimension) || {}).name,
        getProps: ([{ card, data: { cols }}]) => ({
            options: cols.filter(isDimension).map(getOptionFromColumn)
        }),
        getHidden: (series, vizSettings) => vizSettings["map.type"] !== "region"
    },
    // TODO: translate legacy settings
    "map.zoom": {
        default: 9
    },
    "map.center_latitude": {
        default: 37.7577 //defaults to SF ;-)
    },
    "map.center_longitude": {
        default: -122.4376
    }
};

const SETTINGS_PREFIXES_BY_CHART_TYPE = {
    line: ["graph.", "line."],
    area: ["graph.", "line.", "stackable."],
    bar: ["graph.", "stackable."],
    pie: ["pie."],
    scalar: ["scalar."],
    table: ["table."],
    map: ["map."]
}

// alias legacy map types
for (const type of ["state", "country", "pin_map"]) {
    SETTINGS_PREFIXES_BY_CHART_TYPE[type] = SETTINGS_PREFIXES_BY_CHART_TYPE["map"];
}

function getSetting(id, vizSettings, series) {
    if (id in vizSettings) {
        return;
    }

    const settingDef = SETTINGS[id];
    const [{ card }] = series;

    for (let dependentId of settingDef.readDependencies || []) {
        getSetting(dependentId, vizSettings, series);
    }

    if (settingDef.getValue) {
        vizSettings[id] = settingDef.getValue(series, vizSettings);
    } else if (card.visualization_settings[id] === undefined && settingDef.getDefault) {
        vizSettings[id] = settingDef.getDefault(series, vizSettings);
    } else if (card.visualization_settings[id] === undefined && "default" in settingDef) {
        vizSettings[id] = settingDef.default;
    } else if (card.visualization_settings[id] !== undefined) {
        vizSettings[id] = card.visualization_settings[id];
    }

    return vizSettings[id];
}

function getSettingIdsForSeries(series) {
    const [{ card }] = series;
    const prefixes = SETTINGS_PREFIXES_BY_CHART_TYPE[card.display] || [];
    return Object.keys(SETTINGS).filter(id => _.any(prefixes, (p) => id.startsWith(p)))
}

export function getSettings(series) {
    let vizSettings = {};
    for (let id of getSettingIdsForSeries(series)) {
        getSetting(id, vizSettings, series);
    }
    return vizSettings;
}

function getSettingWidget(id, vizSettings, series, onChangeSettings) {
    const settingDef = SETTINGS[id];
    const value = vizSettings[id];
    return {
        ...settingDef,
        id: id,
        value: value,
        hidden: settingDef.getHidden ? settingDef.getHidden(series, vizSettings) : false,
        disabled: settingDef.getDisabled ? settingDef.getDisabled(series, vizSettings) : false,
        props: {
            ...(settingDef.props ? settingDef.props : {}),
            ...(settingDef.getProps ? settingDef.getProps(series, vizSettings) : {})
        },
        onChange: (value) => {
            const newSettings = { [id]: value };
            for (const id of (settingDef.writeDependencies || [])) {
                newSettings[id] = vizSettings[id];
            }
            onChangeSettings(newSettings)
        }
    };
}

export function getSettingsWidgets(series, onChangeSettings) {
    const vizSettings = getSettings(series);
    return getSettingIdsForSeries(series).map(id =>
        getSettingWidget(id, vizSettings, series, onChangeSettings)
    );
}
