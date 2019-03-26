(ns metabase.util.export
  (:require [cheshire.core :as json]
            [clojure.data.csv :as csv]
            [clojure.java.io :as io]
            [dk.ative.docjure.spreadsheet :as spreadsheet]
            [ring.util.io :as ring-io])
  (:import [java.io BufferedWriter ByteArrayInputStream ByteArrayOutputStream File OutputStreamWriter]
           org.apache.poi.ss.usermodel.Cell))

;; add a generic implementation for the method that writes values to XLSX cells that just piggybacks off the
;; implementations we've already defined for encoding things as JSON. These implementations live in
;; `metabase.middleware`.
(defmethod spreadsheet/set-cell! Object [^Cell cell, value]
  (when (= (.getCellType cell) Cell/CELL_TYPE_FORMULA)
    (.setCellType cell Cell/CELL_TYPE_STRING))
  ;; stick the object in a JSON map and encode it, which will force conversion to a string. Then unparse that JSON and
  ;; use the resulting value as the cell's new String value.  There might be some more efficient way of doing this but
  ;; I'm not sure what it is.
  (.setCellValue cell (str (-> (json/generate-string {:v value})
                               (json/parse-string keyword)
                               :v))))

(defn- results->cells
  "Convert the resultset to a seq of rows with the first row as a header"
  [results]
  (cons (map :display_name (get-in results [:result :data :cols]))
        (get-in results [:result :data :rows])))

(defn- export-to-xlsx [columns rows]
  "Write a workbook to an OutputStream"
  (let [wb          (spreadsheet/create-workbook "Query result" (cons (mapv name columns) rows))
        stream-xlsx (fn [out] (spreadsheet/save-workbook-into-stream! out wb)
                      (.flush out))]
    (ring-io/piped-input-stream #(stream-xlsx (io/make-output-stream % {})))))

(defn export-to-xlsx-file
  "Write an XLS file to `FILE` with the header a and rows found in `RESULTS`"
  [^File file results]
  (let [file-path (.getAbsolutePath file)]
    (->> (results->cells results)
         (spreadsheet/create-workbook "Query result" )
         (spreadsheet/save-workbook! file-path))))

(defn- export-to-csv [columns rows]
  "Write a CSV file directly to an output stream, prevents loading full CSV into memory"
  (let [csv        (into [(mapv name columns)] rows)
        stream-csv (fn [out] (csv/write-csv out csv)
                     (.flush out))]
    (ring-io/piped-input-stream #(stream-csv (io/make-writer % {})))))

(defn export-to-csv-writer
  "Write a CSV to `FILE` with the header a and rows found in `RESULTS`"
  [^File file results]
  (with-open [fw (java.io.FileWriter. file)]
    (csv/write-csv fw (results->cells results))))

(defn- export-to-json [columns rows]
  (for [row rows]
    (zipmap columns row)))

(def export-formats
  "Map of export types to their relevant metadata"
  {"csv"  {:export-fn    export-to-csv
           :content-type "text/csv"
           :ext          "csv"
           :context      :csv-download},
   "xlsx" {:export-fn    export-to-xlsx
           :content-type "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
           :ext          "xlsx"
           :context      :xlsx-download},
   "json" {:export-fn    export-to-json
           :content-type "applicaton/json"
           :ext          "json"
           :context      :json-download}})
