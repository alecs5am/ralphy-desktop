import Foundation
import Testing
@testable import RalphyMediaCore

@Test func legacyRejectedAnnotationMigratesToRejectVerdict() throws {
    let data = Data(#"{"rating":2,"favorite":false,"rejected":true,"tags":[" Slop ","slop"],"note":"","updatedAt":"1970-01-01T00:00:01Z"}"#.utf8)

    let annotation = try JSONDecoder.ralphy.decode(MediaAnnotation.self, from: data)

    #expect(annotation.verdict == .reject)
    #expect(annotation.tags == ["slop"])
}

@Test func annotationNormalizesTagsAndClampsRating() {
    let annotation = MediaAnnotation(
        rating: 8,
        favorite: true,
        verdict: .maybe,
        tags: ["  Caf\u{00E9} ", "cafe\u{301}", "", "CAF\u{00C9}"],
        note: "Reference this framing."
    )

    #expect(annotation.rating == 5)
    #expect(annotation.favorite)
    #expect(annotation.verdict == .maybe)
    #expect(annotation.tags == ["caf\u{00E9}"])
}

@Test func rejectedCompatibilityPropertyOnlyClearsRejectVerdict() {
    var annotation = MediaAnnotation(verdict: .keep)
    annotation.rejected = false
    #expect(annotation.verdict == .keep)

    annotation.rejected = true
    #expect(annotation.verdict == .reject)

    annotation.rejected = false
    #expect(annotation.verdict == .unreviewed)
}

@Test func reviewVocabularyPreservesStoredKeepAndMaybeValues() {
    #expect(ReviewVerdict.keep.rawValue == "keep")
    #expect(ReviewVerdict.keep.displayName == "Approved")
    #expect(ReviewVerdict.maybe.displayName == "Shortlist")
    #expect(ReviewVerdict.needsWork.rawValue == "needs-work")
}
